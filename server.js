#!/bin/env node

var express = require('express');
var fs      = require('fs');
var request = require('request');
var redis   = require('redis');
var client;


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

            client = redis.createClient();
        } else {
            client = redis.createClient( process.env.OPENSHIFT_REDIS_PORT, process.env.OPENSHIFT_REDIS_HOST );
            client.auth( process.env.REDIS_PASSWORD );
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

        //  Add handlers for the app (from the routes).
        self.app.get(/^\/id\/(\d+)?$/, function(req, res) {
            var video_id = req.params[0];

            client.get(video_id, function(err, result) {

                if (err || !result) {
                    console.log('Querying vimeo ID: ', video_id);
                    self.queryVimeo( req, res, video_id );
                } else {
                    console.log("Redis works!", result);
                    request(result).pipe(res);
                }
           })
        })

        self.app.get('/', function(req, res) {
            req.write('Test');
        });
    };

    self.queryVimeo = function( req, res, video_id ) {
       request('http://vimeo.com/api/oembed.json?url=http://vimeo.com/' + video_id, function(err, response, body) {
            if ( !err && response.statusCode == 200 ) {

                var json = JSON.parse(body);

                client.setex(video_id, 21600, json.thumbnail_url );
                request( json.thumbnail_url).pipe(res);
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