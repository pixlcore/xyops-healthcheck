#!/usr/bin/env node

// xyOps / Nginx Health Check System
// Automatically switches nginx routing between xyOps Conductor servers
// Copyright (c) 2025 PixlCore LLC.  MIT License.

const cp = require('child_process');
const PixlServer = require('pixl-server');
const Component = require('pixl-server/component');
const PixlRequest = require('pixl-request');
const Tools = require('pixl-tools');

// map XYOPS_ env vars to HEALTHCHECK_, for convenience
for (let key in process.env) {
	if (key.match(/^XYOPS_(.+)$/)) process.env[ 'HEALTHCHECK_' + RegExp.$1 ] = process.env[key];
}

class HealthCheck extends Component {
	
	startup(callback) {
		this.logDebug(3, "Health Check starting up", process.argv );
		this.logDebug(5, "Local server time is: " + (new Date()).toString() );
		
		// use global config
		this.config = this.server.config;
		
		// create a http request instance for pinging conductors
		this.request = new PixlRequest( "xyOps HealthCheck v" + this.server.__version );
		this.request.setTimeout( 5 * 1000 );
		this.request.setAutoError( true );
		this.request.setKeepAlive( true );
		
		// prep master list
		this.masters = this.config.get('masters') || [];
		if (typeof(this.masters) == 'string') this.masters = this.masters.split(/\,\s*/);
		this.port = this.config.get('port');
		
		// setup polling loop
		this.masterHost = '';
		this.pollFreqSec = this.config.get('poll_freq_sec');
		this.lastCheck = Tools.timeNow(true);
		this.server.on('tick', this.tick.bind(this));
		
		this.checkMasters();
		callback();
	}
	
	tick() {
		// poll every N seconds
		let now = Tools.timeNow(true);
		if (now - this.lastCheck >= this.pollFreqSec) {
			this.lastCheck = now;
			this.checkMasters();
		}
	}
	
	checkMasters() {
		// See if we need to swap masters
		let self = this;
		
		if (this.checkInProgress) return;
		this.checkInProgress = true;
		
		// if we have a master, just ping that one to make sure it is still master
		if (this.masterHost) {
			this.pingMaster( this.masterHost, function(is_master) {
				if (is_master) {
					// server is still up, nothing else to do
					self.checkInProgress = false;
					return;
				}
				
				// oh no, server is no longer master -- check all servers
				self.checkInProgress = false;
				self.masterHost = '';
				self.checkMasters();
			} );
			return;
		}
		
		// check all servers to see which one is master
		this.logDebug(6, "Checking all servers", this.masters);
		
		Tools.async.each( this.masters,
			function(host, callback) {
				self.pingMaster(host, function(is_master) {
					if (is_master) self.masterHost = host;
					callback();
				});
			},
			function() {
				// did we choose a new master?
				self.checkInProgress = false;
				
				if (self.masterHost) {
					self.logDebug(5, "A new master has been chosen: " + self.masterHost);
					self.activateMaster();
				}
				else {
					self.logDebug(6, "No master servers are up, will check again in " + self.pollFreqSec + " sec");
				}
			}
		); // each
	}
	
	activateMaster() {
		// activate new master and reload nginx
		let self = this;
		let reload_cmd = this.config.get('nginx_reload_cmd');
		let config_file = this.config.get('nginx_conf_file');
		let config_payload = Tools.sub( this.config.get('nginx_template'), { host: this.masterHost, port: this.port } );
		
		this.logDebug(5, "Installing new master: " + config_file );
		Tools.writeFileAtomicSync( config_file, config_payload );
		
		this.logDebug(5, "Reloading nginx: " + reload_cmd );
		try {
			let stdout = cp.execSync( reload_cmd, { encoding: 'utf8' } );
			if (stdout.match(/\S/)) this.logDebug(6, "Command output: " + stdout);
		}
		catch (err) {
			this.logError('nginx', "Failed to reload nginx: " + err, err);
		}
	}
	
	pingMaster(host, callback) {
		// ping single master, return status
		let self = this;
		let port = this.port;
		let url = this.config.get('poll_proto') + '//' + host + ':' + port + '/health';
		this.logDebug(9, "Pinging server: " + url);
		
		this.request.json( url, false, function(err, resp, data, perf) {
			if (err) {
				self.logDebug(6, "Error pinging server: " + url + ": " + err);
				callback(false);
			}
			else {
				self.logDebug(9, "Ping success -- server is master");
				callback(true);
			}
		});
	}
	
	shutdown(callback) {
		// shut down healthcheck
		callback();
	}
	
} // class

// chdir to the proper server root dir
process.chdir( __dirname );

const server = new PixlServer({
	__name: 'HealthCheck',
	__version: require('./package.json').version,
	configFile: "config.json",
	components: [ HealthCheck ]
});

server.on('init', function() {
	// early check for valid config
	let masters = this.config.get('masters');
	if (!masters || !masters.length) {
		console.warn("FATAL ERROR: No masters (conductors) defined for health check. Exiting.");
		process.exit(1);
	}
});

server.startup( function() {
	// server startup complete
	process.title = server.__name + ' Server';
} );
