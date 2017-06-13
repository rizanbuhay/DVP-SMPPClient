/**
 * Created by Sukitha on 4/25/2017.
 */


var amqp = require('amqp');
var logger = require('dvp-common/LogHandler/CommonLogHandler.js').logger;
var request = require('request');
var format = require("stringformat");
var CreateEngagement = require('dvp-common/ServiceAccess/common').CreateEngagement;
var CreateComment = require('dvp-common/ServiceAccess/common').CreateComment;
var CreateTicket = require('dvp-common/ServiceAccess/common').CreateTicket;
var GetCallRule = require('dvp-common/ServiceAccess/common').GetCallRule;
var UpdateComment = require('dvp-common/ServiceAccess/common').UpdateComment;
var config = require('config');
var uuid = require('node-uuid');
var Render = require('dvp-common/TemplateGenerator/template.js').Render;
var queueHost = format('amqp://{0}:{1}@{2}:{3}',config.RabbitMQ.user,config.RabbitMQ.password,config.RabbitMQ.ip,config.RabbitMQ.port);
var queueName = config.Host.smsQueueName;

var smpp = require('./Workers/smpp');


var queueConnection = amqp.createConnection({
    url: queueHost
}, {
    reconnect: true,
    reconnectBackoffStrategy: 'linear',
    reconnectExponentialLimit: 120000,
    reconnectBackoffTime: 1000
});

queueConnection.on('ready', function () {
    queueConnection.queue(queueName, {durable: true, autoDelete: false},function (q) {
        q.bind('#');
        q.subscribe({
            ack: true,
            prefetchCount: 5
        }, function (message, headers, deliveryInfo, ack) {

            /*message = JSON.parse(message.data.toString());*/
            //logger.info(message);
            if (!message || !message.to || !message.company || !message.tenant) {
                logger.error('SMS - Invalid message, skipping');
                return ack.acknowledge();
            }
            //!message.from ||



            GetCallRule(message.company , message.tenant, message.from, message.to, "SMS", function(isDone, result){
                if(isDone){

                    if(result && result.TrunkNumber){

                        message.from = result.TrunkNumber;
                        SendSMS(message,  deliveryInfo.deliveryTag.toString('hex'), ack);

                    }else{

                        logger.error("There is no trunk number found system will proceed with default SMS number");
                        message.from = config.Host.smsNumber;
                        SendSMS(message,  deliveryInfo.deliveryTag.toString('hex'), ack);
                    }

                }else{

                    logger.error("There is no trunk number found system will proceed with default SMS number");
                    message.from = config.Host.smsNumber;
                    SendSMS(message,  deliveryInfo.deliveryTag.toString('hex'), ack);
                }
            });
            ///////////////////////////create body/////////////////////////////////////////////////

        });
    });
});



function SendSMPP(company, tenant, mailoptions, cb){

    logger.info("Send SMS started .....");

    smpp.SendSMPP(mailoptions.from, mailoptions.to, mailoptions.text, function (_isDone, id) {

        try {

            if (_isDone) {

                logger.debug("Successfully send sms");

                //channel, company, tenant, from, to, direction, session, data, user,channel_id,contact,  cb

                CreateEngagement('sms', company, tenant, mailoptions.from, mailoptions.to, 'outbound', id, mailoptions.text, undefined, undefined, undefined, function (done, result) {
                    if (done) {
                        logger.debug("engagement created successfully");
                        if (mailoptions.reply_session) {

                            CreateComment('sms', 'text', company, tenant, mailoptions.reply_session, mailoptions.author, result, function (done) {
                                if (!done) {
                                    logger.error("comment creation failed");
                                    return cb(true);
                                } else {
                                    logger.debug("comment created successfully");
                                    return cb(true);
                                }
                            });
                        }
                        else {


                            if (mailoptions.ticket) {

                                var ticket_type = 'action';
                                var ticket_priority = 'low';
                                var ticket_tags = [];

                                if (mailoptions.ticket_type) {
                                    ticket_type = mailoptions.ticket_type;
                                }

                                if (mailoptions.ticket_priority) {
                                    ticket_priority = mailoptions.ticket_priority;
                                }

                                if (mailoptions.ticket_tags) {
                                    ticket_tags = mailoptions.ticket_tags;
                                }

                                CreateTicket("sms", sessionid, result.profile_id, company, tenant, ticket_type, mailoptions.text, mailoptions.text, ticket_priority, ticket_tags, function (done) {
                                    if (done) {
                                        logger.info("Create Ticket Completed ");
                                    } else {
                                        logger.error("Create Ticket Failed ");
                                    }
                                    return cb(true);
                                });
                            } else {

                                if (mailoptions.comment) {

                                    UpdateComment(mailoptions.comment, id, function (done) {
                                        if (done) {
                                            logger.info("Update Comment Completed ");

                                        } else {

                                            logger.error("Update Comment Failed ");

                                        }

                                        return cb(true);
                                    });

                                } else {
                                    return cb(true);
                                }
                            }

                        }
                    } else {
                        logger.error("engagement creation failed");
                        return cb(false);
                    }
                });

            } else {

                logger.error("Send SMS Failed ");
                return cb(false);
            }
        }
        catch (excep) {

            logger.error("Send SMS Failed "+excep);
            return cb(false);
        }

    });


};



function SendSMS(message, deliveryInfo, ack) {


    logger.debug("DVP-SocialConnector.SendSMS Internal method ");
    var jsonString;
    var tenant = message.tenant;
    var company = message.company;



    var mailOptions = {
        from: message.from,
        to: message.to,
        text: message.body,
        ticket: message.ticket,
        comment: message.comment,
        author: message.author,
        reply_session: message.reply_session,
        ticket_type : message.ticket_type,
        ticket_priority : message.ticket_priority,
        ticket_tags : message.ticket_tags
    };


    logger.debug(message);

    if(message && message.template){


        logger.info("render started");

        Render(message.template,company,tenant,message.Parameters, function(isDone, message){
            logger.info("render is completed");

            if(isDone && message){

                mailOptions.text = message;


                SendSMPP(company, tenant, mailOptions, function (done) {

                    if (!done)
                        ack.acknowledge();
                    //.reject(true);
                    else
                        ack.acknowledge();

                });


            }else{


                logger.error("Render failed ");
                //ack.reject(true);
                ack.acknowledge();

            }
        });

    }else {

        SendSMPP(company, tenant, mailOptions, function (done) {

            if (!done)
            //ack.reject(true);
                ack.acknowledge();
            else
                ack.acknowledge();


        });
    }

};


module.exports.SendSMS = SendSMS;
