/**
 * Created by Sukitha on 11/25/2016.
 */
var config = require('config');
var smpp = require('smpp');
var logger = require('dvp-common/LogHandler/CommonLogHandler.js').logger;
var CallDynamicConfigRouting = require('dvp-common/ServiceAccess/common').CallDynamicConfigRouting;
var CallHttProgrammingAPI = require('dvp-common/ServiceAccess/common').CallHttProgrammingAPI;
var util = require("util");

var smpphost = config.SMPPClient.ip;
var smppport = config.SMPPClient.port;
var system_type = config.SMPPClient.system_type;
var address_range = config.SMPPClient.address_range;

var didConnect = false;
var isConnected = false;


var session = new smpp.Session({host: smpphost, port: smppport});

session.on('connect', function(){

    var username = config.SMPPClient.user;
    var password = config.SMPPClient.password;
    didConnect = true;
    isConnected = true;

    session.bind_transceiver({
        system_id: username,
        password: password,
        interface_version: 1,
        system_type: system_type,
        address_range: address_range,
        //380666000600
        addr_ton: 1,
        addr_npi: 1,
    }, function(pdu) {
        logger.info('pdu status', lookupPDUStatusKey(pdu.command_status));
        if (pdu.command_status == 0) {
            logger.info('Successfully bound')
        }
    });
});


session.on('close', function(){
    logger.info('smpp disconnected');
    isConnected = false;
    if (didConnect) {
        connectSMPP();
    }
});



session.on('error', function(error){
    logger.error('smpp error', error)
    isConnected = false;
    //didConnect = true;
    //process.exit(1);
});


function lookupPDUStatusKey(pduCommandStatus) {
    for (var k in smpp.errors) {
        if (smpp.errors[k] == pduCommandStatus) {
            return k
        }
    }
};

function connectSMPP() {
   logger.info('smpp reconnecting');
    session.connect();
}

var sendSMPP = function(from, to, text, cb) {

    if(!isConnected) {

        from = from.toString();
        to = to.toString();


        logger.info("from :" + from);
        logger.info("to :" + to);
        logger.info("text :" + text);

        session.submit_sm({
            source_addr: from,
            destination_addr: to,
            short_message: text
        }, function (pdu) {
            logger.info('sms pdu status', lookupPDUStatusKey(pdu.command_status));
            if (pdu.command_status == 0) {
                // Message successfully sent
                logger.info(pdu.message_id);
                cb(true, pdu.message_id)
            } else {

                cb(false);
            }
        });
    }else{

        logger.error(util.format("Message send failed due to connection is closed from %s to %s text %s",from, to, text));

        cb(false);
    }
}


session.on('pdu', function(pdu){

    // incoming SMS from SMSC
    logger.info(pdu);
    if (pdu.command == 'deliver_sm') {

        // no '+' here
        var fromNumber = pdu.source_addr.toString();
        var toNumber = pdu.destination_addr.toString();

        var text = '';
        if (pdu.short_message && pdu.short_message.message) {
            text = pdu.short_message.message;
        }

        logger.info("SMS " + fromNumber + " -> " + toNumber + ": " + text);

        //////////////////call dynamic config and route to the httapi//////////////////////////////////////////

        CallDynamicConfigRouting(fromNumber, toNumber,text,'inbound',function(isDone, reqId){
            if(isDone){

                CallHttProgrammingAPI(fromNumber, toNumber, text, reqId, function(isDone){
                    if(isDone){

                        logger.info("SMS proceed successfully");

                    }else{
                        logger.error("Call HTTProgrammingAPI success");
                    }
                })

            }else{

                logger.error("Call Dynamic configuration routing failed");
            }

        });

        // Reply to SMSC that we received and processed the SMS
        session.deliver_sm_resp({ sequence_number: pdu.sequence_number });
    }
});


module.exports.SendSMPP = sendSMPP;
