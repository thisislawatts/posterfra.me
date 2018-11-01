#!/bin/env node
const express = require('express');
const request = require('request');
const redis   = require('redis');
const youtube = require('youtube-api');
const serverStatic = require('serve-static');
const imgix = require('imgix-core-js');

const Rollbar = require('rollbar');

let logger;

if (process.env.ROLLBAR_ACCESS_TOKEN) {
    logger = new Rollbar({
        accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
        captureUncaught: true,
        captureUnhandledRejections: true
    });
    logger.log('Logging to rollbar');
} else {
    logger = console;
    logger.log('Logging to console');
}

require('dotenv').config({
    silent: true
});

if (!process.env.GOOGLE_API_KEY) {
    logger.warn('No GOOGLE_API_KEY var available, unable to query Youtube');
} else {
    logger.log('Authenticating Youtube');
    youtube.authenticate({
        type: 'key',
        key: process.env.GOOGLE_API_KEY,
        userIp: '123.123.123.1'
    });
}

const imgixNotAvailable = !process.env.IMGIX_HOST_URL || !process.env.IMGIX_SECURE_URL_TOKEN;
logger.log('Imgix is unavailable?', imgixNotAvailable );

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
            logger.log('Redis Error:', e);
        });

        if (typeof self.ipaddress === 'undefined') {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            logger.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = '127.0.0.1';

        }
    };

    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === 'string') {
            logger.log('%s: Received %s - terminating sample app ...',
                Date(Date.now()), sig);
            process.exit();
        }
        logger.log('%s: Node server stopped.', Date(Date.now()) );
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
            logger.log('Request audit:', {
                originalUrl: req.originalUrl,
                referrer: req.headers.referrer,
            } );

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


        logger.log('Override cache?', matches );

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

    self.respond = function(res, url, originalRequestUrl) {
        if (originalRequestUrl.match(/^\/p|pipe/)) {
            return request(url).pipe(res);
        }

        return res.redirect( url );
    };

    self.fetchVimeo = function(req, res, properties ) {
        self.client.get(properties.id, function(err, result) {
            logger.log('Original URL:', req.originalUrl );

            if (err || !result || self.overrideCache(req.originalUrl)) {
                logger.log('Querying vimeo ID: ', properties.id);
                self.queryVimeo( req, res, properties );
            } else {
                self.respond( res, self.resizeThumbnailByUrl( result, req.query ), req.originalUrl);
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

            logger.log('Original URL:', req.originalUrl );
            logger.log('Youtube ID:', youtube_id );

            try {
                self.client.get( youtube_id, function(err, result) {
                    if (err || !result || self.overrideCache(req.originalUrl) ) {
    
                        youtube.videos.list({
                            part: 'id,snippet',
                            id: youtube_id
                        }, function(err,data) {
                            if (err || !data) {
                                logger.error('Error response from youtube', {err, data});
                                throw err;
                            }

                            if (!data.items.length) {
                                logger.error('Empty response from youtube', {
                                    youtubeId: youtube_id,
                                    data,
                                });
                                return res.sendfile('public/images/static.png');
                            }
    
                            if ( data.items.length ) {
                                var thumbnails = data.items.pop().snippet.thumbnails;
                                var largest_thumbnail = thumbnails[ Object.keys(thumbnails)[Object.keys(thumbnails).length -  1]];
    
                                self.client.setex( youtube_id, 21600, largest_thumbnail.url );
                                self.respond(res, largest_thumbnail.url, req.originalUrl);
                            }
                        });    
                    } else {
                        logger.log('Loading via Redis:', result );
                        self.respond(res, result, req.originalUrl);
                    }
                });
            } catch (error) {
                logger.error('Error fetching Youtube video', {
                    youtubeId: youtube_id,
                    error,
                });
            }
        } else {
            logger.warn('Error fetching youtube URL:', {
                originalUrl: req.originalUrl,
            } );
        }
    };

    self.resizeThumbnailByUrl = function ( thumbnail_url, properties ) {
        if (Object.keys(properties).length === 0 || imgixNotAvailable) {
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
            logger.log('Response', {err, response, body});
            if (err && response.statusCode !== 200) {
                logger.log('Error fetching oEmbed', {err, response});
                return res.statusCode(400);
            }

            try {
                var json = JSON.parse(body);
                logger.log('Query vimeo reponse', {json});

                if (!json.thumbnail_url) {
                    logger.warn('Failed to find thumbnail in vimeo response', {
                        json,
                    });
                    return res.sendfile('public/images/static.png');
                }

                var thumbnail_url = self.resizeThumbnailByUrl( json.thumbnail_url.replace(/_[0-9x]+/,''), req.query );
                self.client.setex(properties.id, 21600, json.thumbnail_url.replace(/_[0-9x]+/,'') );
                self.respond(res, thumbnail_url, req.originalUrl );
            } catch (error) {
                logger.log('Failed to parse vimeo response', {
                    error,
                    json,
                });
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
            logger.log('%s: Node server started on http://%s:%d ...',
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
