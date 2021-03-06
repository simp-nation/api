const express = require('express'),
	app = express(),
	bodyParser = require('body-parser'),
	morgan = require('morgan'),
	toml = require('toml'),
	fs = require('fs'),
	settings = toml.parse(fs.readFileSync('./settings.toml')),
	Database = require('./structures/Database'),
	mailTransport = require('./structures/mailTransport'),
	webhookTransport = require('./structures/webhookTransport'),
	db = new Database(settings.mongo),
	raven = require('raven');

mailTransport.config({ from: settings.email.from, test: settings.email.test });
webhookTransport.config(settings.webhooks);

if (process.env.NODE_ENV === 'production') {
	raven.disableConsoleAlerts();
	raven.config(settings.raven.url, {
		release: (require('./package.json')).version,
		autoBreadcrumbs: { 'http': true },
		captureUnhandledRejections: true
	}).install();

	app.use(raven.requestHandler());
	app.use(raven.errorHandler());

	global.statsd = new (require("node-dogstatsd")).StatsD(settings.statsd.host, settings.statsd.port);

	var datadog = require('connect-datadog')({
		dogstatsd: statsd,
		tags: ['app:catgirls-api'],
		response_code: true,
		path: true,
		method: true
	});

	app.use(datadog);
} else {
	global.statsd = new Proxy({ }, {
		get() { return function() { } }
	});
}

app.set('trust proxy', 'loopback');
app.set('env', 'production');
app.disable('x-powered-by');

app.use(morgan(':req[cf-connecting-ip] :method :url :status :response-time[0]ms', {
	skip: (req, res) => res.statusCode < 400 // Only log failed requests/responses
}));
// Parse data into req.body
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// In dev we need a way to get images
if (process.env.NODE_ENV === 'development') {
	app.use('/image', express.static('image', { index: false, extensions: ['jpg'] }));
	app.use('/thumbnail', express.static('thumbnail', { index: false, extensions: ['jpg'] }));
}

app.use((req, res, next) => {
	res.set('Access-Control-Allow-Origin', '*');
	res.set('Access-Control-Allow-Credentials', 'true');
	res.set('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,PATCH,DELETE');
	res.set('Access-Control-Allow-Headers', 'Access-Control-Allow-Headers, Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, Authorization');
	return next();
});

// Load in the routes for express
let apiv1 = new (require('./api/v1/Router.js'))(settings, db, mailTransport, webhookTransport);
app.use(apiv1.path, apiv1.router);

// Start the express server
app.listen(settings.port, error => {
	if (error)
		return console.log(error)
	console.log('Server online');
});
