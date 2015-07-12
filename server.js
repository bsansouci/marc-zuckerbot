var login = require("facebook-chat-api");
var chrono = require('chrono-node');
var Firebase = require("firebase");
var shortId = require('shortid');
var phonetic = require("phonetic");
var request = require("request");

// Little binding to prevent heroku from complaining about port binding
var http = require('http');
http.createServer(function (req, res) {
  console.log("ping");
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end("");
}).listen(process.env.PORT || 5000);

setInterval(function() {
  http.get("http://marc-zuckerbot.herokuapp.com", function(res) {
    console.log("pong");
  });
}, 1800000 * Math.random() + 1200000); // between 20 and 50 min


if(!process.env.MARC_ZUCKERBOT_FIREBASE) return console.error("MARC_ZUCKERBOT_FIREBASE env variable isn't set!");


var ericURL = "http://192.168.1.101:34567/?data=";
if(process.env.ERIC_URL) ericURL = process.env.ERIC_URL;

var MARC_ID = 100009069356507;
var db = new Firebase(process.env.MARC_ZUCKERBOT_FIREBASE);
var chatsDB = db.child("chats");
var listsDB = db.child("lists");
var usersDB = db.child("users");
var anonymousUsersDB = db.child("anonymousUsers");


function _get(url, qs, callback) {
  if(typeof qs === 'function') {
    callback = qs;
    qs = {};
  }
  for(var prop in qs) {
    if(typeof qs[prop] === "object") {
      console.log("You probably shouldn't pass an object inside the form at property", prop, qs);
      continue;
    }
    qs[prop] = qs[prop].toString();
  }
  var op = {
    headers: {
      'Content-Type' : 'application/x-www-form-urlencoded',
      'Host' : url.replace('https://', '').split("/")[0],
      'User-Agent' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/600.3.18 (KHTML, like Gecko) Version/8.0.3 Safari/600.3.18',
      'Connection' : 'keep-alive',
    },
    timeout: 30000,
    qs: qs,
    url: url,
    method: 'GET',
    gzip: true
  };

  request(op, callback);
}

function startBot(api, chats, lists, users, anonymousUsers) {
  // If there is no state, the toString() function on an undefined property
  // will return the string undefined. This is going to be our default.
  var allCommands = {
    'default': [addScore, spank, hashtag, subtractScore,score, ping, xkcdSearch, arbitraryLists, slap, hug, topScore, sendStickerBigSmall, reminders, setTimezone, sendPrivate, ignore, staticText, salute, weekendText, sexxiBatman, bees, albert, ericGame, sendSplit, sendBirthday],
    'in-game': [pipeToEric],
    'ignored': [ignore]
  };

  // Defaults in case they don't exist (because firebase doesn't save empty
  // objects)
  chats = chats || {};
  lists = lists || {};
  users = users || {};
  anonymousUsers = anonymousUsers || {};

  var currentUsername;
  var currentUserId;
  var currentThreadId;
  var currentChat;
  var currentOtherUsernames;
  var currentOtherIds;

  function timerDone(d) {
    api.sendMessage('Reminder: ' + d.text, d.thread_id);
    chats[d.thread_id].reminders = chats[d.thread_id].reminders.filter(function(v) {
      return v.text !== d.text || v.date !== d.date;
    });
    chatsDB.set(chats);
  }

  var now = Date.now();
  for(var prop in chats) {
    if(chats.hasOwnProperty(prop) && chats[prop].reminders) {
      chats[prop].reminders.map(function(v) {
        var diff = (new Date(v.date)).getTime() - now;
        if(diff <= 0) {
          return timerDone(v);
        }

        setTimeout(timerDone, diff, v);
      });
    }
  }

  // Main method
  api.listen(function(err, message, stopListening) {
    if(err) return console.error(err);

    console.log("Received ->", message);
    read(message.body, message.sender_name.split(' ')[0], message.thread_id, message.sender_id, message.participant_names, message.participant_ids, function(msg) {
      if(!msg) return;

      console.log("Sending ->", msg);
      if(msg.text && msg.text.length > 0) api.sendMessage(msg.text, message.thread_id);
      else if(msg.sticker_id) api.sendSticker(msg.sticker_id, message.thread_id);
      else api.markAsRead(message.thread_id);
    });
  });


  // messages, username, chat id are Strings, otherUsernames is array of Strings
  function read(message, username, thread_id, userId, otherUsernames, otherIds, callback) {
    // Default chat object or existing one
    // And set the global object
    currentChat = chats[thread_id] = chats[thread_id] || {
      lists: {},
      scores: {},
      existingChat: false
    };
    if(!currentChat.lists) currentChat.lists = {};
    if(!currentChat.scores) currentChat.scores = {};
    if(!currentChat.reminders) currentChat.reminders = [];
    if(!users[userId]) users[userId] = {};

    if (!currentChat.existingChat){
      currentChat.existingChat = true;
      api.sendMessage("Hey I'm a chatbot and here to help. Type '/help' for some useful commands!", thread_id);
    }
    currentThreadId = thread_id;
    currentUserId = userId;
    currentUsername = username;
    currentOtherUsernames = otherUsernames;

    // Remove one Marc
    if(currentOtherUsernames.indexOf("Marc") !== -1) {
      currentOtherUsernames.splice(currentOtherUsernames.indexOf("Marc"), 1);
    }

    // Remove marc from this list
    currentOtherIds = otherIds.filter(function(v) {return v !== MARC_ID;});

    var availableCommands = allCommands.default;
    // if we have data for the user, and he has talked in this current chat
    // and his state isn't null, then we use the appropriate set of commands
    // for the given state
    if(users[currentUserId] && users[currentUserId][thread_id] && users[currentUserId][thread_id].state) {
      availableCommands = allCommands[users[currentUserId][thread_id].state];
    }

    for (var i = 0; i < availableCommands.length; i++) {
      availableCommands[i](message, function(msg) {
        // Async saving to firebase

        // chatsDB.set(chats);
        // listsDB.set(lists);
        // usersDB.set(users);
        // anonymousUsersDB.set(anonymousUsers);
        callback(msg);
      });
    }
  }

  function ignore(msg, sendReply) {
    var match = matches(/^\/(ignore|unignore)/i, msg);
    if(!match) return;

    var text = match.trim();
    if(text === "ignore") {
      if(users[currentUserId] && users[currentUserId][currentThreadId] && users[currentUserId][currentThreadId].state === "ignored") {
        return sendReply({text: "I'm already ignoring you. If you want me to stop ignoring you please do /unignore."});
      }
      users[currentUserId] = users[currentUserId] || {};
      users[currentUserId][currentThreadId].state = "ignored";
      return sendReply({text: "Messages from you will now be ignored. Do /unignore to stop being ignored."});
    } else {
      if(users[currentUserId] && users[currentUserId][currentThreadId].state === "ignored") {
        delete users[currentUserId][currentThreadId];
        return sendReply({text: "Oh hey " + currentUsername + " you're there!"});
      }

      return sendReply({text: "Sorry I'm not ignoring you. If you want me to, do /ignore."});
    }
  }

  function reply(msg, sendReply) {
    var match = matches(/^\/(reply .*)/i, msg);
    if(!match) return;

    return sendReply({text: "Can't reply for now, I'm working on it."});

    //if(!users[currentUserId] || !users[currentUserId].preMessage) return sendReply({text: "No previous message to reply to."});
  }

  function pipeToEric(msg, sendReply) {
    var match = matches(/^\/(.*)/i, msg);
    if(!match) return;

    var commandToSend = match.trim().replace(/\s+/g, "+");
    if(commandToSend === "stop-game") {
      currentOtherIds.map(function(v) {
        if(users[v] && users[v][currentThreadId]) users[v][currentThreadId].state = null;
        if(users[v] && users[v][v]) users[v][v].state = null;
      });
      // return sendReply({text: "Game stopped"});
    }
    var cachedCurrentOtherIds = currentOtherIds;
    var cachedCurrentOtherUsernames = currentOtherUsernames;
    _get(ericURL + [currentThreadId, currentUserId, commandToSend].join("+"), function(err, res, html) {
      if(!html) return console.error("No html from eric?");
      var arr = html.split("@@");
      arr = arr.map(function(v, i) {
        if(i % 2 === 1) return v;
        return cachedCurrentOtherIds.reduce(function(acc, u) {
          return acc.split(u).join(cachedCurrentOtherUsernames[cachedCurrentOtherIds.indexOf(u)]);
        }, v);
      });
      if(arr.length === 1 && arr[0].length > 0) {
        return sendReply({text: arr[0]});
      }
      // Send the reply into the main thread
      sendReply({text: arr[0]});

      // Send individual replies to private threads
      var characters = arr.slice(1, arr.length);
      for (var i = 0; i < characters.length; i += 2) {
        var playerId = parseInt(characters[i]);
        var message = characters[i+1];
        // Check if there's a message sent to zuckerbot
        // if yes and the message is end, that means the game is done
        if(characters[i] === 'zuckerbot') {
          var splittedMessage = message.split(" ");
          var action = splittedMessage[0];
          var threadId = parseInt(splittedMessage[1]);
          if(action === "end") {
            cachedCurrentOtherIds.map(function(v) {
              users[v][threadId].state = null;
            });
            // if(users[threadId] && users[threadId][threadId]) users[threadId][threadId].state = null;
          }
          continue;
        }
        console.log(i, characters, characters[i], playerId, cachedCurrentOtherUsernames[cachedCurrentOtherIds.indexOf(playerId)]);
        api.sendMessage(message, playerId, function(err) {
          if(err) {
            console.error(err);
            throw new Error("look above");
          }
        });
      }
    });
  }

  function ericGame(msg, sendReply) {
    var match = matches(/^\/(start-game.*)/i, msg);
    if(!match) return;

    var difficulty = match.trim().split(' ')[1];
    _get(ericURL + [currentThreadId, currentUserId, "start-game", difficulty].concat(currentOtherIds).join("+"), function(err, res, html) {
      if(err) return console.error(err);
      if(!html) return console.error("Empty packet....");

      var arr = html.split("@@");
      if(arr.length === 1) {
        return sendReply({text: html});
      }

      currentOtherIds.map(function(v) {
        users[v] = users[v] || {};
        users[v][currentThreadId] = {
          state:"in-game"
        };
        users[v][v] = {
          state:"in-game"
        };
      });

      sendReply({text: arr[0]});
      var characters = arr.slice(1, arr.length);
      for (var i = 0; i < characters.length; i += 2) {
        var playerId = parseInt(characters[i]);
        var char = characters[i+1];
        api.sendMessage(currentOtherUsernames[currentOtherIds.indexOf(playerId)] + char, playerId, function(err) {
          if(err) throw err;
        });
      }
    });
  }

  function sendPrivate(msg, sendReply) {
    var match = matches(/^\/send-private (.*)/i, msg);
    if(!match) return;

    var words = match.trim().split(':');

    if(words.length < 2) return {text: 'Usage: /send-private name : message'};

    var name = "";
    var tmp = words[0].split(' ');
    for (var i = 0; i < tmp.length; i++) {
      name += tmp[i];
    }
    name = name.toLowerCase();

    var message = words.slice(1).join(':').trim();

    var anonymousName = getAnonymous(currentUserId);
    var num = 1;
    var cached = anonymousName;
    while(anonymousUsers[anonymousName] && anonymousUsers[anonymousName] !== currentUserId) {
      anonymousName = cached + (num++);
    }
    anonymousUsers[anonymousName] = currentUserId;
    // If the given name is an anonymous user, we use the stored userId to send
    // the message
    if(anonymousUsers[name]) {
      name = parseInt(anonymousUsers[name]);
    }

    api.sendDirectMessage(anonymousName + ": '" + message + "'", name, function(err) {
      if(err) console.log(err);
    });

    return sendReply({text: "Message '"+message+"' sent."});
  }

  function setTimezone(msg, sendReply) {
    var match = matches(/^\/settimezone (.*)/i, msg);
    if(!match) return;

    var rest = match.trim();
    if(!timezonesOffsets[rest]) return;

    currentChat.timezone = rest;

    return sendReply({
      text: "Set the currentChat timezone to " + rest + "."
    });
  }

  function reminders(msg, sendReply) {
    var match = matches(/^\/remind(.*)/i, msg);
    if(!match) return;

    var rest = match.trim();

    if(!currentChat.hasOwnProperty("timezone")) return sendReply({text: "Please set your timezone with the /settimezone command"});
    var ret = chrono.parse(rest + " " + currentChat.timezone);
    if(ret.length === 0) return;

    var date = ret[0].start.date();
    var time = new Date(date.toUTCString()).getTime();

    currentChat.reminders.push({
      text: rest.replace(ret[0].text, ''),
      date: date.toISOString(),
      thread_id: currentThreadId
    });

    var now = new Date();
    now = new Date(now.toUTCString()).getTime();

    if(now >= time) {
      timerDone(currentChat.reminders[currentChat.reminders.length - 1]);
    } else {
      setTimeout(timerDone, time - now, currentChat.reminders[currentChat.reminders.length - 1]);
    }
    return sendReply({text: "Reminder at: " + date.toISOString().replace(/T/, ' ').replace(/\..+/, '') + " --> '" + rest.replace(ret[0].text, '')+'\''});
  }

  function staticText(msg, sendReply) {
      var possibilities = [
          [[/^(hey )?marc\??$/i],["Sup", "Hey :D", "hey", "Me?", "yes?"]],
          [[/^(sup|wassup|what's up|how are you)\??$/i], ["I'm tired", "Not much, you?", "Meh...", "I'm great, how about you?", "What's up with you?", "Nothing much, you?"]],
          [[/(who made you|who's your creator|where do you come from)/i], ["I'm a long story... About 24h long.", "I'm not too sure", "I never really asked myself this question."]],
          [[/(^\/sayit)/i], ["David's an idiot"]],
          [[/^\/(help.*)/],["Try these commands:\n- /list help\n- hey marc\n- /ping\n- /slap\n- /slap name\n- /hug name\n- /sayit\n- /xkcd keyword\n- name++\n- /score name\n- /topscore\n- /send-private firstname lastname: message\n- /remind have fun tomorrow at 2pm\n- /settimezone EDT\n- /ignore\n- /unignore"]],
          [[/( |^)(chat)?(bot)s?( |$)/i], ["Are you talking about me?", "I am a chat bot.", "Pick me, pick me!"]],
          [[/<3 (marc)/i], ["I <3 you too!", "Share the <3.", "Hey ;)", "I love you too, " + currentUsername + "."]]
      ];
      for (var i = 0; i < possibilities.length; i++) {
          var possibleMatches = possibilities[i][0];
          for (var j = 0; j < possibleMatches.length; j++) {
              var match = possibleMatches[j].exec(msg);
              if(match && match.length > 0) {
                  return sendReply({text: randFrom(possibilities[i][1])});
              }
          }
      }
  }

  function sendStickerBigSmall(msg, sendReply) {
      var possibilities = [
          [[/( |^)(small|big)( |$)/i], [767334526626290, 767334556626287, 767334506626292]]
      ];
      for (var i = 0; i < possibilities.length; i++) {
          var possibleMatches = possibilities[i][0];
          for (var j = 0; j < possibleMatches.length; j++) {
              var match = possibleMatches[j].exec(msg);
              if(match && match.length > 0) {
                  return sendReply({sticker_id: randFrom(possibilities[i][1])});
              }
          }
      }
  }

  function sendBirthday(msg, sendReply) {
    var match = matches(/( |^)(birthday)( |$)/i, msg);
    if (!match) return;


    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth();

    var stickers = [144884805685786, 657501937666397, 401768673292031, 162333030618222, 553453074782034, 320763728117773, 201013703381897];

    api.getUserInfo(currentOtherIds, function(err, ret) {
      if(err) return console.error(err);

      for(var prop in ret) {
        if(ret.hasOwnProperty(prop) && ret[prop].is_birthday) {
          sendSplitMessage(currentThreadId, "HAPPY BIRTHDAY " + ret[prop].firstName.toUpperCase(), randFrom(stickers));
        }
      }
    });
  }

  function slap(msg, sendReply) {
    var match = matches(/^\/(slap\s*.*)/i, msg);
    if (!match) return;

    var arr = match.trim().toLowerCase();
    var list = arr.split(/\s+/);
    if(list.length === 1) return sendReply({text: currentOtherUsernames[~~(currentOtherUsernames.length * Math.random())] + " just got slapped."});

    var name = list[1];
    if(name === "me") return sendReply({text: currentUsername + " just go slapped." + (Math.random() > 0.5 ? " Hard.": "")});

    if(anonymousUsers[name]) {
      api.sendMessage(getAnonymous(currentUserId) + " just slapped you.", anonymousUsers[name]);
      return sendReply({text: name + " was told that they got slapped."});
    }

    return sendReply({text: capitalize(name) + " just got slapped." + (Math.random() > 0.5 ? " Hard.": "")});
  }

  function subtractScore(msg, sendReply) {
    var match = matches(/^ (.+)\-\-/i, msg);
    if (!match) return;

    var name = match.trim()toLowerCase();

    name = capitalize(name);
    if (contains(currentOtherUsernames, name)) {
      var score = (currentChat.scores[name] ? currentChat.scores[name] : 0) - 1;
      currentChat.scores[name] = score;
      return sendReply({text: name + "'s score is now " + score + "."});
    }
    return sendReply({text: "Who's " + name + "?"});
  }

  function spank(msg, sendReply) {
    var match = matches(/^\/(spank\s*.*)/i, msg);
    if (!match) return;

    var arr = match.trim().toLowerCase();
    var list = arr.split(/\s+/);
    if (list.length === 1) return sendReply({text: currentUsername + " just got spanked." + (Math.random() < 0.5 ? “ So. Hard. ;)”: “”)});

    if (anonymousUsers[name]) {
      api.sendMessage(getAnonymous(currentUserId) + " just spanked you.", anonymousUsers[name]);
      return sendReply({text: name + " was told that they got spanked."});
    }
    return sendReply({text: capitalize(name) + " just got spanked." + (Math.random() < 0.5 ? “ So. Hard. ;)”: “”)});
  }

  function hug(msg, sendReply) {
    var match = matches(/^\/(hug\s*.*)/i, msg);
    if (!match) return;

    var arr = match.trim().toLowerCase();
    var list = arr.split(/\s+/);
    if(list.length === 1) return sendReply({text: currentOtherUsernames[~~(currentOtherUsernames.length * Math.random())] + " just got a "+(Math.random() > 0.5 ? "BIG ": "")+"hug."});

    var name = list[1];
    if(name === "me") return sendReply({text: currentUsername + " just got a "+(Math.random() > 0.5 ? "BIG ": "")+"hug."});

    if(anonymousUsers[name]) {
      api.sendMessage(getAnonymous(currentUserId) + " just hugged you.", anonymousUsers[name]);
      return sendReply({text: name + " was given a "+(Math.random() > 0.5 ? "BIG ": "")+"hug."});
    }

    return sendReply({text: capitalize(name) + " just got a "+(Math.random() > 0.5 ? "BIG ": "")+"hug."});
  }

  function weekendText(msg, sendReply) {
    var match = matches(/( |^)is it (weekend)\s*\?/i, msg);
    if (!match) return;

    var today = new Date();
    return sendReply({text: (today.getDay() === 0 || today.getDay() === 6 ? "YES" : "NO")});
  }


  function addScore(msg, sendReply) {
    var match = matches(/^(.+)\+\+/i, msg);
    if (!match) return;

    var name = match.trim().toLowerCase();

    name = capitalize(name);
    if (name === currentUsername) {
      return sendReply({text: name + ", you can't upvote yourself -_- "});
    }
    if (contains(currentOtherUsernames, name)) {
      var score = (currentChat.scores[name] ? currentChat.scores[name] : 0) + 1;
      currentChat.scores[name] = score;
      return sendReply({text: name + "'s score is now " + score + "."});
    }

    return sendReply({text: "Who's " + name + "?"});
  }

  function salute(msg, sendReply) {
      var match = matches(/general\s+(\w+)/i, msg);
      if (!match) return;

      var general = match.trim();
      return sendReply({text: "*salute* General " + general});
  }

  function score(msg, sendReply) {
    var match = matches(/^\/score([\w .\-]*)$/i, msg);
    if (!match) return;

    var name = match.trim().toLowerCase();
    if (name.length < 1 || name === "me") name = currentUsername;

    name = capitalize(name);
    if (!contains(currentOtherUsernames, name)) return sendReply({text: "who?"});

    var pts = currentChat.scores[name] ? currentChat.scores[name] : 0;
    return sendReply({text: ("" + name + " has " + pts + " points")});
  }

  function albert(msg, sendReply) {
    var match = matches(/^\/albert$/i, msg);
    if (!match) return;
    var k =  "\n         ,---,_          ,\n          _>   `'-.  .--'/\n     .--'` ._      `/   <_\n      >,-' ._'.. ..__ . ' '-.\n   .-'   .'`         `'.     '.\n    >   / >`-.     .-'< \\ , '._\\\n   /    ; '-._>   <_.-' ;  '._>\n   `>  ,/  /___\\ /___\\  \\_  /\n   `.-|(|  \\o_/  \\o_/   |)|`\n       \\;        \\      ;/\n         \\  .-,   )-.  /\n          /`  .'-'.  `\\\n         ;_.-`.___.'-.;\n";
    return sendReply({text: k});
  }

  function bees(msg, sendReply) {
    if (matches(/( |^)bees( |$)/i, msg)) {
      return sendReply({text: "http://cdn.gifstache.com/2012/7/19/gifstache.com_893_1342731571.gif"});
    }
  }

  function hashtag(msg, sendReply) {
    if (matches(/( |^)#[A-Za-z]+/, msg)) {
      return sendReply({text: "HASHTAG #hashtag"})
    }
  }

  function sexxiBatman(msg, sendReply) {
    if (matches(/(wanna make some trouble)/i, msg)) {
      return sendReply({text: "http://99gifs.com/-img/514e8830afa96f09940128f8.gif"});
    }
  }

  function ping(msg, sendReply) {
    var match = matches(/^\/(ping)$/i, msg);
    if (!match) return;

    return sendReply({text: "pong"});
  }

  function xkcdSearch(msg, sendReply) {
    var match = matches(/^\/xkcd\s+(.+)/i, msg);
    if (!match) return;

    var search = match.trim().toLowerCase().replace(/ /g, "+");
    var searchUrl = "http://derp.co.uk/xkcd/page?q=" + search + "&search=Search";
    return sendReply({text: "Find relevant xkcds here: " + searchUrl});
  }

  function giphySearch(msg, sendReply) {
    var data = "";
    if(msg.indexOf("giphy") > -1) {
      var strippedString = msg.replace(/^\s+|\s+$/g, '');
      strippedString = strippedString.replace("giphy", '');

      var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
      var request = new XMLHttpRequest();
      request.open('GET', 'http://api.giphy.com/v1/gifs/random?api_key=dc6zaTOxFJmzC&tag='+strippedString, false);

      request.onload = function() {
        if (request.status >= 200 && request.status < 400){
          data = JSON.parse(request.responseText).data.image_url;
          console.log(data);
          return sendReply({text: data});
        } else {
          return sendReply({text: "No gif for this search result."});
        }
      };

      request.onerror = function() {
        console.log('Connection error');
      };

      request.send(null);
      console.log("request sent");
    }
  }

  function arbitraryLists(msg, sendReply) {
    var list = matches(/^\/(list\s*.*)/i, msg);
    if (!list) return;

    list = list.trim();
    var arr = list.split(/\s+/);
    if(arr.length === 1) return sendReply({text: (Object.keys(currentChat.lists).length > 0 ? "Existing Lists: \n" + Object.keys(currentChat.lists).map(function(v, i) {
      return (i + 1) + " - " + v;
    }).join("\n") : "No existing list.")});

    var keyword = arr[1].toLowerCase();
    var listName = arr.length > 2 ? arr[2] : "";
    if(keyword === 'new') {
      if(currentChat.lists[listName]) {
        return sendReply({text: "List '" + listName + "' already exists."});
      }
      if(listName.length > 0) {
        var newList = {
          id: shortId.generate(),
          name: listName,
          thread_id: currentThreadId
        };
        currentChat.lists[listName] = newList;

        lists[newList.id] = {
          name: listName,
          thread_id: currentThreadId,
          content: []
        };
        return sendReply({text: "List '" + listName + "' created."});
      }
    } else if (keyword === 'delete') {
      if (!currentChat.lists[listName]) {
        return sendReply({text: "No list of name '"+listName+"' exists."});
      }

      if(!lists[currentChat.lists[listName].id].content) {
        return sendReply({text: "List '" + listName + "' is emtpy."});
      }

      // If the delete command was given a number
      if(arr.length > 3) {
        var num = parseInt(arr[3]);
        if(isNaN(num)) return sendReply({text: num + " isn't an an item number in the list " + listName + "."});

        if(num - 1 >= lists[currentChat.lists[listName].id].content.length || num - 1 < 0) {
          return sendReply({text: "Item " + num + " in list '" + listName + "' doesn't exist."});
        }

        // Remove the item at index num - 1 (0 indexed here, 1 indexed for
        // users)
        lists[currentChat.lists[listName].id].content.splice(num - 1, 1);

        // We then print the modified list
        return sendReply({text: listName + ": \n" + lists[currentChat.lists[listName].id].content.map(function(v, i) {return (i + 1) + " - " + v.data;}).join("\n")});
      }

      // If the delete command wasn't given a number, we assume the user wants
      // to delete the whole list
      if(listName.length > 0) {
        // We check for permissions to delete the whole list
        if(currentChat.lists[listName].thread_id !== currentThreadId) return {text: "Sorry you can't delete the list. This list was created in another chat."};
        var id = currentChat.lists[listName].id;
        delete lists[id];
        delete currentChat.lists[listName];

        // Now we need to iterate through all the chats and remove that list
        // from any chat that has it

        for(var prop in chats) {
          if(chats.hasOwnProperty(prop) && chats[prop].lists && chats[prop].lists[listName] && chats[prop].lists[listName].id === id) {
            delete chats[prop].lists[listName];
          }
        }
        return sendReply({text: "List '" + listName + "' deleted."});
      }
    } else if (keyword === 'add') {
      if(listName.length > 0 && arr.length > 3) {
        if (!currentChat.lists[listName]) {
          return sendReply({text: "No list of name '"+listName+"' exists."});
        }
        if(!lists[currentChat.lists[listName].id].content) {
          lists[currentChat.lists[listName].id].content = [];
        }
        var item = {
          data: arr.slice(3).join(' '),
          creator: currentUsername
        };
        lists[currentChat.lists[listName].id].content.push(item);
        return sendReply({text: "Added '" + arr.slice(3).join(' ') + "' to " + listName + "."});
      }
    } else if(keyword === 'import') {
      var id = listName;

      if (!lists[id]) {
        return sendReply({text: id+" isn't a valid list ID."});
      }

      currentChat.lists[lists[id].name] = {
        id: id,
        name: lists[id].name,
        thread_id: lists[id].thread_id
      };

      return sendReply({text: "List '" + lists[id].name +"' added to current thread."});
    } else if(keyword === 'share') {
      if (!currentChat.lists[listName]) {
        return sendReply({text: "No list of name '"+listName+"' exists."});
      }

      return sendReply({text: "Paste this into another chat to import the list '"+listName+"':\n/list import " + currentChat.lists[listName].id});
    } else if(keyword === 'blame') {
      if (!currentChat.lists[listName]) {
        return sendReply({text: "No list of name '"+listName+"' exists."});
      }
      if(arr.length > 3) {
        var num = parseInt(arr[3]);
        if(isNaN(num)) return sendReply({text: num + " isn't an an item number in the list " + listName + "."});

        if(num - 1 >= lists[currentChat.lists[listName].id].content.length || num - 1 < 0) {
          return sendReply({text: "Item " + num + " in list '" + listName + "' doesn't exist."});
        }

        var item = lists[currentChat.lists[listName].id].content[num - 1];
        return sendReply({text: "Item " + num + " was added by " + item.creator});
      }

      return sendReply({text: "Usage: /list blame list-name item-number"});
    } else if (currentChat.lists[keyword]) {
      if(!lists[currentChat.lists[keyword].id]) {
        var id = currentChat.lists[keyword].id;
        for(var prop in chats) {
          if(chats.hasOwnProperty(prop) && chats[prop].lists && chats[prop].lists[keyword] && chats[prop].lists[keyword].id === id) {
            delete chats[prop].lists[keyword];
          }
        }
        return sendReply({text: "Cannot find list with id `"+id+"`.  Attempting to repair."});
      } else if(!lists[currentChat.lists[keyword].id].content) {
        return sendReply({text: "List '" + keyword + "' is emtpy."});
      }
      return sendReply({text: keyword + ": \n" + lists[currentChat.lists[keyword].id].content.map(function(v, i) {return (i + 1) + " - " + v.data;}).join("\n")});
    }

    return sendReply({text: "Usage:\n /list \n /list list-name\n /list new list-name \n /list delete list-name\n /list delete list-name item-number\n /list add list-name new-element"});
  }

  function topScore(msg, sendReply) {
    var match = matches(/^\/(topscores?)$/i, msg);

    if (!match) return;
    var max = -1;
    var maxName = "";
    for (var i = 0; i < currentOtherUsernames.length; i++) {
      var score = currentChat.scores[currentOtherUsernames[i]] ? currentChat.scores[currentOtherUsernames[i]] : 0;
      if (score > max) {
        max = score;
        maxName = currentOtherUsernames[i];
      }
    }
    return sendReply({text: "Top Score: " + maxName+ ", with "+max+" points."});
  }

  function sendSplit(msg) {
    var match = matches(/^\/sendsplit\s+(.+)$/i, msg);
    if (!match) return;

    sendSplitMessage(currentThreadId, match);
  }

  function matches(regex, msg) {
    var match = regex.exec(msg) || [];
    return match[1];
  }

  function sendSplitMessage(targetId, message, stickerId, callback){
    if (message.length === 0){
      if (typeof stickerId !== 'undefined'){
        api.sendSticker(stickerId, targetId, callback);
      } else {
        callback();
      }
    } else if (message.length >= 40) {
      return;
    } else {
      api.sendMessage(message[0], targetId, function(err, obj) {
        setTimeout(function() {
          sendSplitMessage(targetId, message.substring(1), stickerId);
        }, 200);
      });
    }
  }

  function hashUsername(name) {
    var arr = name.split('').map(function(v) {return v.charCodeAt(0);});
    arr[0] = (arr[0] + arr[arr[1] % arr.length]) % 26 + 97;
    for (var i = 1; i < arr.length; i++) {
      arr[i] = (arr[i] + arr[i - 1] % arr.length) % 26 + 97;
    }

    return arr.reduce(function(acc, val) {
      acc += String.fromCharCode(val);
      return acc;
    }, "");
  }

  function capitalize(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function randFrom(arr) {
    return arr[~~(arr.length * Math.random())];
  }

  function replaceAll(find, replace, str) {
    return str.replace(new RegExp(find, 'g'), replace);
  }

  function contains(array, obj) {
    for (var i = array.length - 1; i >= 0; i--) {
      if (array[i] === obj) return true;
    }
    return false;
  }

  function getAnonymous(id) {
    return phonetic.generate({seed: id}).toLowerCase();
  }

  var timezonesOffsets = {"A":60,"ACDT":630,"ACST":570,"ADT":-180,"AEDT":660,"AEST":600,"AFT":270,"AKDT":-480,"AKST":-540,"ALMT":360,"AMST":-180,"AMT":-240,"ANAST":720,"ANAT":720,"AQTT":300,"ART":-180,"AST":-240,"AWDT":540,"AWST":480,"AZOST":0,"AZOT":-60,"AZST":300,"AZT":240,"B":120,"BNT":480,"BOT":-240,"BRST":-120,"BRT":-180,"BST":60,"BTT":360,"C":180,"CAST":480,"CAT":120,"CCT":390,"CDT":-300,"CEST":120,"CET":60,"CHADT":825,"CHAST":765,"CKT":-600,"CLST":-180,"CLT":-240,"COT":-300,"CST":-360,"CVT":-60,"CXT":420,"ChST":600,"D":240,"DAVT":420,"E":300,"EASST":-300,"EAST":-360,"EAT":180,"ECT":-300,"EDT":-240,"EEST":180,"EET":120,"EGST":0,"EGT":-60,"EST":-300,"ET":-300,"F":360,"FJST":780,"FJT":720,"FKST":-180,"FKT":-240,"FNT":-120,"G":420,"GALT":-360,"GAMT":-540,"GET":240,"GFT":-180,"GILT":720,"GMT":0,"GST":240,"GYT":-240,"H":480,"HAA":-180,"HAC":-300,"HADT":-540,"HAE":-240,"HAP":-420,"HAR":-360,"HAST":-600,"HAT":-90,"HAY":-480,"HKT":480,"HLV":-210,"HNA":-240,"HNC":-360,"HNE":-300,"HNP":-480,"HNR":-420,"HNT":-150,"HNY":-540,"HOVT":420,"I":540,"ICT":420,"IDT":180,"IOT":360,"IRDT":270,"IRKST":540,"IRKT":540,"IRST":210,"IST":60,"JST":540,"K":600,"KGT":360,"KRAST":480,"KRAT":480,"KST":540,"KUYT":240,"L":660,"LHDT":660,"LHST":630,"LINT":840,"M":720,"MAGST":720,"MAGT":720,"MART":-510,"MAWT":300,"MDT":-360,"MESZ":120,"MEZ":60,"MHT":720,"MMT":390,"MSD":240,"MSK":240,"MST":-420,"MUT":240,"MVT":300,"MYT":480,"N":-60,"NCT":660,"NDT":-90,"NFT":690,"NOVST":420,"NOVT":360,"NPT":345,"NST":-150,"NUT":-660,"NZDT":780,"NZST":720,"O":-120,"OMSST":420,"OMST":420,"P":-180,"PDT":-420,"PET":-300,"PETST":720,"PETT":720,"PGT":600,"PHOT":780,"PHT":480,"PKT":300,"PMDT":-120,"PMST":-180,"PONT":660,"PST":-480,"PT":-480,"PWT":540,"PYST":-180,"PYT":-240,"Q":-240,"R":-300,"RET":240,"S":-360,"SAMT":240,"SAST":120,"SBT":660,"SCT":240,"SGT":480,"SRT":-180,"SST":-660,"T":-420,"TAHT":-600,"TFT":300,"TJT":300,"TKT":780,"TLT":540,"TMT":300,"TVT":720,"U":-480,"ULAT":480,"UTC":0,"UYST":-120,"UYT":-180,"UZT":300,"V":-540,"VET":-210,"VLAST":660,"VLAT":660,"VUT":660,"W":-600,"WAST":120,"WAT":60,"WEST":60,"WESZ":60,"WET":0,"WEZ":0,"WFT":720,"WGST":-120,"WGT":-180,"WIB":420,"WIT":540,"WITA":480,"WST":780,"WT":0,"X":-660,"Y":-720,"YAKST":600,"YAKT":600,"YAPT":600,"YEKST":360,"YEKT":360,"Z":0};
}

// Main function
db.once('value', function(snapshot) {
  var data = snapshot.val() || {};

  login({
    email: process.env.FB_LOGIN_EMAIL,
    password: process.env.FB_LOGIN_PASSWORD
  }, function(err, api) {
    if(err) return console.error(err);

    startBot(api, data.chats, data.lists, data.users, data.anonymousUsers);
  });
});
