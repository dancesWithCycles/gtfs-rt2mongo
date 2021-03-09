/*
Copyright (C) 2021  Stefan Begerad

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

require('dotenv').config();
const helmet = require('helmet');
const compression = require('compression');
const debug=require('debug')('gtfs-rt-post2mongo')
const protobuf=require('protobufjs')
const xpress=require('express')
const bodyParser = require('body-parser');
const https = require('https');
const fs = require('fs');
const mongoose = require('./mongooseConnect')
const Location=require('./models/location.js')

const app = xpress();
app.use(compression()); //Compress all routes
app.use(helmet());//protect against vulnerabilities
app.use(bodyParser.raw({type: 'application/octet-stream'}))

run().catch(err => {
    debug('...run error')
    console.log(err)
});

async function run() {
    debug('run...')
    debug('__dirname: %s',__dirname)

    const protoFile=__dirname+'/gtfs-realtime.proto'
    debug('protoFile: %s',protoFile)

    //async load of protobuf file
    const root=await protobuf.load(protoFile)

    // Obtain message types
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage")
    const FeedEntity = root.lookupType("transit_realtime.FeedEntity");

    const ROUTE=process.env.ROUTE||'/post';
    debug('ROUTE: '+ROUTE)
    
    app.post(ROUTE, function(req, res) {
	debug('req.url %s',req.url)
	debug('req.method %s',req.method)
	debug('req.headers %s',JSON.stringify(req.headers))

	debug('req.boy len: %s',req.body.length)
	const dataBuffer=Buffer.from(req.body,'binary')
	debug('dataBuffer len: %s',dataBuffer.length)
	const dataDecoded = FeedMessage.decode(dataBuffer)
	debug('dataDecoded as JSON: %s',JSON.stringify(dataDecoded))

	//create new Location instance based on request
	let loc = new Location()
	loc.uuid=''
	loc.lat=0;
	loc.lon=0;
	loc.ts=0;
	loc.alias=''
	loc.vehicle=''
	loc.label=''
	loc.licensePlate=''
	//debug('new loc: %s',loc);

	dataDecoded.entity.forEach(function(entity){
	    if(entity.vehicle){
		debug('vehicle position')
		const vehicle=entity.vehicle
		if(vehicle.vehicle){
		    debug('vehicle')
		    const vehDes=vehicle.vehicle
		    if(vehDes.id){
			debug('id: %s',vehDes.id)
			loc.uuid=vehDes.id
		    }else{
			debug('id unavailable')
		    }
		    if(vehDes.label){
			debug('label: %s',vehDes.label)
			loc.label=vehDes.label
		    }else{
			debug('label unavailable')
		    }
		    if(vehDes.licensePlate){
			debug('licensePlate: %s',vehDes.licensePlate)
			loc.licensePlate=vehDes.licensePlate
		    }else{
			debug('licensePlate unavailable')
		    }
		}else{
		    debug('vehicle unavailable')
		}
		if(vehicle.position){
		    debug('position')
		    const position=vehicle.position
		    if(position.latitude){
			const latitude=position.latitude
			debug('latitude: %s',latitude)
			loc.lat=latitude
		    }else{
			debug('latitude unavailable')
		    }
		    if(position.longitude){
			const longitude=position.longitude
			debug('longitude: %s',longitude)
			loc.lon=longitude
		    }else{
			debug('longitude unavailable')
		    }
		}else{
		    debug('position unavailable')
		}
		if(vehicle.timestamp){
		    debug('timestamp: %s',vehicle.timestamp)
		    loc.ts=vehicle.timestamp
		}else{
		    debug('timestamp unavailable')
		}
            }else{
		debug('entity unsupported')
            }
	})
	//debug('new loc: %s',loc);

	//check database for existing locations
	findLocation(loc);

	res.end();
    });
    
    const PORT=parseInt(process.env.PORT, 10)||55555
    debug('PORT: '+PORT)
    //await app.listen(PORT)
    // pass 'app' to 'https' server
    if (process.env.NODE_ENV !== 'production') {
	await app.listen(PORT);
    }else{
	const PHRASE=process.env.PHRASE||'phrase';
	debug('PHRASE: '+PHRASE)
	https.createServer({
	    key: fs.readFileSync('./p'),
            cert: fs.readFileSync('./f'),
            passphrase: PHRASE
	}, app)
	    .listen(PORT, ()=>debug('listening on port '+PORT))
    }

    const db=mongoose.connection
    db.once('open', _ => {
	debug('Database connected')
    })
    db.on('error', err => {
	console.error('connection error:', err)
    })
}

function updateLocation(locA,locB){
    locA.lat=locB.lat
    locA.lon=locB.lon
    locA.ts=locB.ts
    locA.alias=locB.alias
    locA.vehicle=locB.vehicle
    locA.label=locB.label
    locA.licensePlate=locB.licensePlate
}    

function saveLocation(loc){
    loc.save(function(err, location) {
        if(err){
	    debug('save error:'+err)
	}
    });
}

function findLocation(locNew){
    debug('find location for uuid %s',locNew.uuid);

    //check database for existing locations
    Location.findOne({uuid:locNew.uuid}, function(err, location){
	if(err){
	    debug('find location error: '+err)
	}
	else if(location){
	    //update existing location
	    updateLocation(location,locNew)
	    saveLocation(location)
	}else{
	    //save new location
	    saveLocation(locNew)
	}
    });
}

