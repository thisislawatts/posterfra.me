Posterframe
===========

[![Code Climate](https://codeclimate.com/github/bcmh/posterfra.me/badges/gpa.svg)](https://codeclimate.com/github/bcmh/posterfra.me)

Tiny node service for grabbing the thumbnails for Vimeo content as unlike youtube they don't currently provide their own URL based service.
eg: [http://posterfra.me/http://vimeo.com/60573536](http://posterfra.me/http://vimeo.com/60573536)

By default it will return whatever Vimeo's thumbnail size is, currently ~1280px.

### Setting Up

First up you'll want to get [Redis](http://redis.io/) installed and [set up](http://redis.io/download) on your machine. Run `redis-server` to start it up in standalone mode.

Use `npm install` to install the dependencies, then `node server.js` to start the webservice. It will then be available via [http://127.0.0.1:8080](http://127.0.0.1:8080).

You should also create
```

```

### Deployment

I've got it running on Openshift's application platform, find out more information can be found about their `nodejs` [cartridge documentation](https://github.com/openshift/origin-server/tree/master/cartridges/openshift-origin-cartridge-nodejs/README.md).

Set up a Google API key and add it to the Openshift Environment
```
$ rhc env set GOOGLE_API_KEY=<apiKey> -a <appname>
``` 

### Changelog

Version 1.0.0 - Intial Release
