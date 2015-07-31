#!/bin/env node

var express = require('express');
var fs      = require('fs');
var request = require('request');
var redis   = require('redis');
var youtube = require('youtube-api');
var client;

youtube.authenticate({
    type: "key",
    key: "AIzaSyCttKhXmxY0Q3xKH2Sf0p6qe7qTtgdXMBI",
    userIp: '123.123.123.1'
})

/**
 *
 *
 * TODO:
 * [ ] Add Google serverr key as environmental var for openshift server
 * [ ] Private Vimeo thumbnails
 * [ ] Error checking on youtube API
 * [ ] Error checking on Vimeo API
 */

/**
 *  Define the sample application.
 */
var Stilleo = function() {

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
        self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";

            self.client = redis.createClient();
        } else {
            self.client = redis.createClient( process.env.OPENSHIFT_REDIS_PORT, process.env.OPENSHIFT_REDIS_HOST );
            self.client.auth( process.env.REDIS_PASSWORD );
            console.log("Password: ", process.env.REDIS_PASSWORD, process.env.OPENSHIFT_REDIS_PORT, process.env.OPENSHIFT_REDIS_HOST );
        }
    };

    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           process.exit(1);
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
        ].forEach(function(element, index, array) {
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

        self.app.use(function(req, res, next){

            if (req.originalUrl.match(/vimeo\.com/)) {
                var props = self.getPropertiesFromURL( req.originalUrl );
                self.fetchVimeo( req, res, props );
            } else if ( req.originalUrl.match(/youtube/) ) {
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
        var matches = url.match(/^\/force/);

        return matches ? true : false;
    }

    self.getPropertiesFromURL = function( url ) {

        var parts = url.split('/'),
            keys = ['id', 'width'],
            props = {},
            pointer = 0;

        for (var i = 0; i < parts.length; i++) {

            var n = parseInt( parts[i] );
            
            if (!isNaN(n)) {
                props[keys[pointer]] = n;
                pointer++;
            }
        }

        return props;
    }

    self.fetchVimeo = function(req, res, properties ) {
        self.client.get(properties.id, function(err, result) {

            console.log('Original URL:', req.originalUrl );

            if (err || !result || self.overrideCache(req.originalUrl)) {
                console.log('Querying vimeo ID: ', properties.id);
                self.queryVimeo( req, res, properties );
            } else {
                console.log("Redis works!", result, properties );
                request( self.resizeThumbnailByUrl( result, properties ) ).pipe(res);
            }
       })
    }

    self.fetchYoutube = function(req, res, properties ) {
        var ids = req.originalUrl.match('v=([A-z0-9\-]+)');

        if ( ids ) {
            var youtube_id = ids.pop();

            console.log('Original URL:', req.originalUrl );

            self.client.get( youtube_id, function(err, result) {
                if (err || !result || self.overrideCache(req.originalUrl) ) {

                    youtube.videos.list({
                        part: 'id,snippet',
                        id: youtube_id,
                    }, function(err,data) {
                        if (err || !data) {
                            console.log(err, data);
                            console.log(process.env.OPENSHIFT_NODEJS_IP);
                            throw err;
                        } 

                        if ( data.items.length ) {
                            console.log("data", JSON.stringify(data) );
                            var thumbnails = data.items.pop().snippet.thumbnails;
                            var largest_thumbnail = thumbnails[ Object.keys(thumbnails)[Object.keys(thumbnails).length -  1]];

                            self.client.setex( youtube_id, 21600, largest_thumbnail.url );

                            request.get( largest_thumbnail.url ).pipe(res);

                        }
                    })

                } else {
                    console.log("Loading via Redis:", result );
                    request.get( result ).pipe(res);
                }
            })
        }

    }

    self.resizeThumbnailByUrl = function ( thumbnail_url, properties ) {

        if (properties.width)
            thumbnail_url = thumbnail_url.replace(/\_\d+/, '_' + properties.width );

        return thumbnail_url;
    }

    self.queryVimeo = function( req, res, properties ) {
       request('http://vimeo.com/api/oembed.json?url=http://vimeo.com/' + properties.id, function(err, response, body) {
            if ( !err && response.statusCode == 200 ) {

                var json = JSON.parse(body),
                    thumbnail_url = self.resizeThumbnailByUrl( json.thumbnail_url, properties );

                self.client.setex(properties.id, 21600, thumbnail_url );

                console.log(thumbnail_url);
                request( thumbnail_url ).pipe(res);
            } else {
                console.log(err, response);
            }
        });
    }


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
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};   /*  Stilleo Application.  */



/**
 *  main():  Main code.
 */
var zapp = new Stilleo();
zapp.initialize();
zapp.start();