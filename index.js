/**
 * Module dependencies.
 */

var path = require('path'),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require('fs')),
    moment = require('moment'),
    _ = require('underscore');

/**
 * Module defaults
 */
const DEFAULTS = {
    keepFiles: 10, // keep recent 10 files
    format: '<%= date %>_<%= ip %>'
};

/**
 * Convert header key string to Pascal-Case based string.
 *
 * e.g. `toPascalCase('content-type')` returns `'Content-Type'`.
 * @api private
 * @param key
 * @returns {string}
 */
function toPascalCase (key) {
    var chunks = key.split('-');
    return _.map(chunks, function (chunk) {
        var tmp = chunk.split('');
        tmp[0] = tmp[0].toUpperCase();
        return tmp.join('');
    }).join('-');
}


/**
 * Build raw HTTP Request Header from Request Object.
 *
 * @param req
 * @returns {string}
 */
function buildRequestHeader (req) {
    var head = [
            req.method.toUpperCase(),
            req.originalUrl,
            'HTTP/' + req.httpVersion
        ].join(' '), // GET /foo/bar?pretty=doge HTTP/1.1
        body = _.map(req.headers, function (val, key) {
            return toPascalCase(key) + ': ' + val;
        }).join('\n'); // Content-Length: 123 ...

    return head + '\n' + body;
}


/**
 * Cleanup old dump files
 *
 * @param max
 * @param dest
 */
function cleanup (max, dest) {
    var dmpExtRegexp = /\.dmp$/i;

    fs.readdirAsync(dest)
    .then(function (files) {
        var dumps = _.filter(files, function (path) {
            return path.match(dmpExtRegexp);
        });

        if (dumps.length <= max) {
            return;
        }

        Promise.map(dumps, function (filepath) {
            return fs.statAsync(path.join(dest, filepath))
                .then(function (stat) {
                    return Promise.resolve({
                        path: path.join(dest, filepath),
                        createdAt: stat.ctime.getTime()
                    });
                }).catch(function () {
                    return Promise.resolve({
                        path: path.join(dest, filepath),
                        createdAt: -1
                    });
                });
        }, {concurrent: 10})
        .then(function (dumps) {
            var willRemoved = _.sortBy(dumps, function (file) {
                return 0 - file.createdAt;
            }).slice(10);

            return Promise.map(willRemoved, function (file) {
                return fs.unlinkAsync(file.path)
                    .then(function () {
                        return Promise.resolve(true);
                    }).catch(function () {
                        // ignore
                        return Promise.resolve(true);
                    });
            }, {concurrent: 10});
        });
    })
    .catch(function (e) {
        // ignore
    })
}

module.exports = exports = function (req, opts, callback) {
    var ex,
        options = _.defaults(opts|| {}, DEFAULTS),
        filename = _.template(options.format)({
            date: moment().format('YYYYMMDDHHmmss'),
            ip: req.ip
        });

    if (typeof options.dest !== 'string') {
        ex = new Error('Destination path is unspecified, or not string.');
        if(typeof callback ==='function') {
            callback(ex);
            return;
        } else {
            throw ex;
        }
    }

    var stream = fs.createWriteStream(path.join(options.dest, filename + '.dmp'));
    stream.write(buildRequestHeader(req) + '\n\n', 'utf8');
    req.on('end', function () {
        if (req.body) {
            stream.end(JSON.stringify(req.body), 'utf8');
        } else {
            stream.end();
        }
        
        if (typeof callback === 'function') callback(null);
        cleanup(options.keepFiles, options.dest);
    }).pipe(stream);
};