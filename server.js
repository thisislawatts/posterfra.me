#!/bin/env node
const express = require('express');
const request = require('request');
const redis   = require('redis');
const youtube = require('youtube-api');
const serverStatic = require('serve-static');
const imgix = require('imgix-core-js');

require('dotenv').config({
    silent: true
});

if (!process.env.GOOGLE_API_KEY) {
    console.warn('No GOOGLE_API_KEY var available, unable to query Youtube');
} else {
    console.log('Authenticating Youtube')
    youtube.authenticate({
        type: 'key',
        key: process.env.GOOGLE_API_KEY,
        userIp: '123.123.123.1'
    });
}


/**
 *  Define the sample application.
 */
var Posterframe = function() {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */


    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port      = process.env.PORT || 8080;

            self.client = redis.createClient(process.env.REDIS_URL).on('error', function(e) {
                console.log('Redis Error:', e);
            });

        if (typeof self.ipaddress === 'undefined') {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = '127.0.0.1';

        } else {
        }
    };

    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === 'string') {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           process.exit();
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.app = express();

        self.app.set('port', (process.env.PORT || 8080));

        self.app.use(serverStatic('public/'));

        self.app.use(function(req, res, next){

            if (req.originalUrl.match(/vimeo\.com/)) {
                var props = self.getPropertiesFromURL( req.originalUrl );
                self.fetchVimeo( req, res, props );
            } else if ( req.originalUrl.match(/youtube|youtu\.be/) ) {
                self.fetchYoutube( req, res );
            } else {
                next();
            }
        });

        self.app.get('/', function(req, res) {
            res.sendfile('public/index.html');
        });
    };

    self.overrideCache = function( url ) {
        var matches = url.match(/^\/force|f/);


        console.log('Override cache?', matches );

        return matches ? true : false;
    };

    self.getPropertiesFromURL = function( url ) {

        var parts = url.split('/'),
            keys = ['id', 'width'],
            props = {},
            pointer = 0;

        for (var i = 0; i < parts.length; i++) {

            var n = parseInt( parts[i], 10 );

            if (!isNaN(n)) {
                props[keys[pointer]] = n;
                pointer++;
            }
        }

        return props;
    };

    self.fetchVimeo = function(req, res, properties ) {
        self.client.get(properties.id, function(err, result) {
            console.log('Original URL:', req.originalUrl );

            if (err || !result || self.overrideCache(req.originalUrl)) {
                console.log('Querying vimeo ID: ', properties.id);
                self.queryVimeo( req, res, properties );
            } else {
                console.log('Redis works!', result, properties );
                res.redirect( self.resizeThumbnailByUrl( result, req.query ));
            }
       });
    };

    self.fetchYoutube = function(req, res ) {
        var ids = req.originalUrl.match('v=([A-z0-9-]+)');

        if ( ids === null ) {
            ids = [req.originalUrl.split('/').pop()];
        }

        if ( ids ) {
            var youtube_id = ids.pop();

            console.log('Original URL:', req.originalUrl );
            console.log('Youtube ID:', youtube_id );

            self.client.get( youtube_id, function(err, result) {
                if (err || !result || self.overrideCache(req.originalUrl) ) {

                    youtube.videos.list({
                        part: 'id,snippet',
                        id: youtube_id
                    }, function(err,data) {
                        if (err || !data) {
                            console.log(err, data);
                            console.log(process.env.OPENSHIFT_NODEJS_IP);
                            throw err;
                        }

                        if ( data.items.length ) {

                            var thumbnails = data.items.pop().snippet.thumbnails;
                            var largest_thumbnail = thumbnails[ Object.keys(thumbnails)[Object.keys(thumbnails).length -  1]];

                            self.client.setex( youtube_id, 21600, largest_thumbnail.url );

                            res.redirect( largest_thumbnail.url );

                        }
                    });

                } else {
                    console.log('Loading via Redis:', result );
                    res.redirect(result);
                }
            });
        } else {
            console.warn('Error fetching:', req.originalUrl );
        }
    };

    self.resizeThumbnailByUrl = function ( thumbnail_url, properties ) {

        console.log('Imgix credentials present?', !process.env.IMGIX_HOST_URL, !process.env.IMGIX_SECURE_URL_TOKEN );

        if (Object.keys(properties).length === 0 || (!process.env.IMGIX_HOST_URL || !process.env.IMGIX_SECURE_URL_TOKEN)) {
            return thumbnail_url;
        }

        var client = new imgix({
            host: process.env.IMGIX_HOST_URL,
            secureURLToken: process.env.IMGIX_SECURE_URL_TOKEN,
            includeLibraryParam: false
        });

        return client.buildURL(thumbnail_url, properties);
    };

    self.queryVimeo = function( req, res, properties ) {
       request('https://vimeo.com/api/oembed.json?url=http://vimeo.com/' + properties.id, function(err, response, body) {
            if ( !err && response.statusCode === 200 ) {
                var json = JSON.parse(body),
                    thumbnail_url = self.resizeThumbnailByUrl( json.thumbnail_url.replace(/_[0-9x]+/,''), req.query );

                self.client.setex(properties.id, 21600, thumbnail_url );
                console.log(thumbnail_url);
                res.redirect( thumbnail_url );
            } else {
                console.log(err, response);
            }
        });
    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.app.get('port'), function() {
            console.log('%s: Node server started on http://%s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};   /*  Posterframe Application.  */


/**
 *  main():  Main code.
 */
var app = new Posterframe();
app.initialize();
app.start();
