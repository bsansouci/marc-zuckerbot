var login = require("facebook-chat-api");
var chrono = require('chrono-node');
var Firebase = require("firebase");

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
var db = new Firebase(process.env.MARC_ZUCKERBOT_FIREBASE);

function startBot(api, chats) {
  var currentUsername;
  var currentThreadId;
  var currentChat;
  var currentOtherUsernames;

  var timerDone = function(d) {
    api.sendMessage('Reminder: ' + d.text, d.thread_id);
    chats[d.thread_id].reminders = chats[d.thread_id].reminders.filter(function(v) {
      return v.text !== d.text || v.date !== d.date;
    });
    db.set(chats);
  };

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
    var msg = read(message.body, message.sender_name.split(' ')[0], message.thread_id, message.participant_names);
    console.log("Sending ->", msg);

    if(msg.text && msg.text.length > 0) api.sendMessage(msg.text, message.thread_id);

    if(msg.sticker_id) api.sendSticker(msg.sticker_id, message.thread_id);
  });


  // messages, username, chat id are Strings, otherUsernmaes is array of Strings
  var read = function(message, username, thread_id, otherUsernames) {
    // Default chat object or existing one
    // And set the global object
    currentChat = chats[thread_id] = chats[thread_id] || {
      lists: {},
      scores: {},
      existingChat: false
    };
    currentThreadId = thread_id;

    if(!currentChat.lists) currentChat.lists = {};
    if(!currentChat.scores) currentChat.scores = {};
    if(!currentChat.reminders) currentChat.reminders = [];

    if (!currentChat.existingChat){
      currentChat.existingChat = true;
      api.sendMessage("Hey, type '/help' for some useful commands!", thread_id);
    }

    currentUsername = username;
    currentOtherUsernames = otherUsernames;
    var textFunctions = [salute, weekendText, addScore, score, sexxiBatman, bees, ping, xkcdSearch, albert, arbitraryLists, slap, topScore, sendStickerBigSmall, staticText, reminders, setTimezone];
    for (var i = 0; i < textFunctions.length; i++) {
        var res = textFunctions[i](message);
        if (res) {
          // Async saving to firebase
          db.set(chats);
          return res;
        }
    }
    return {};
  };

  var setTimezone = function(msg) {
    var myRegexp = /\/settimezone (.*)/i;
    var match = myRegexp.exec(msg);
    if(!match || match.length === 0) return;
    var rest = match[1].trim();
    if(!timezonesOffsets[rest]) return;
    var offset = (new Date()).getTimezoneOffset() * 60 * 1000;
    currentChat.timezoneOffset = offset + timezonesOffsets[rest] * 60000;

    return {
      text: "Set the currentChat timezone to " + rest + "."
    };
  };

  var reminders = function(msg) {
    var myRegexp = /\/remind(.*)/i;
    var match = myRegexp.exec(msg);
    if(!match || match.length === 0) return;
    var rest = match[1].trim();
    console.log(rest);
    var ret = chrono.parse(rest);
    if(ret.length === 0) return;
    if(!currentChat.hasOwnProperty("timezoneOffset")) return {text: "Please set your timezone with the /settimezone command"};

    var date = ret[0].start.date().toISOString();

    currentChat.reminders.push({
      text: rest.replace(ret[0].text, ''),
      date: date,
      thread_id: currentThreadId
    });
    var now = Date.now() + currentChat.timezoneOffset;
    console.log(ret[0].start.date(), now - ret[0].start.date().getTime() + currentChat.timezoneOffset);
    if(now >= ret[0].start.date().getTime()) {
      timerDone(currentChat.reminders[currentChat.reminders.length - 1]);
    } else {
      setTimeout(timerDone, ret[0].start.date().getTime() - now, currentChat.reminders[currentChat.reminders.length - 1]);
    }
    return {text: "Reminder at: " + date.replace(/T/, ' ').replace(/\..+/, '') + " --> '" + rest.replace(ret[0].text, '')+'\''};
  };

  var staticText = function(msg) {
      var possibilities = [
          [[/(hey marc$|marc\?)/i],["Sup", "Hey :D", "hey", "Me?", "yes?"]],
          [[/(sup|wassup|what's up|how are you)\??$/i], ["I'm tired", "Not much, you?", "Meh...", "I'm great, how about you?", "What's up with you?", "Nothing much, you?"]],
          [[/(who made you|who's your creator|where do you come from)/i], ["I'm a long story... About 24h long.", "I'm not too sure", "I never really asked myself this question."]],
          [[/(\/sayit)/i], ["David's an idiot"]],
          [[/\/(help.*)/],["Try these commands:\n- /list help\n- hey marc\n- /ping\n- /slap [name]\n- /sayit\n- /xkcd keyword\n- name++\n- /score [name]\n- /topscore"]],
          [[/( |^)(chat)?(bot)s?( |$)/i], ["Are you talking about me?", "I am a chat bot.", "Pick me, pick me!"]]
      ];
      for (var i = 0; i < possibilities.length; i++) {
          var possibleMatches = possibilities[i][0];
          for (var j = 0; j < possibleMatches.length; j++) {
              var match = possibleMatches[j].exec(msg);
              if(match && match.length > 0) {
                  return {text: randFrom(possibilities[i][1])};
              }
          }
      }
  };

  var sendStickerBigSmall = function(msg) {
      var possibilities = [
          [[/(small|big)/i], [767334526626290, 767334556626287, 767334506626292]]
      ];
      for (var i = 0; i < possibilities.length; i++) {
          var possibleMatches = possibilities[i][0];
          for (var j = 0; j < possibleMatches.length; j++) {
              var match = possibleMatches[j].exec(msg);
              if(match && match.length > 0) {
                  return {sticker_id: randFrom(possibilities[i][1])};
              }
          }
      }
  };

  var slap = function(msg) {
    var myRegexp = /^\/(slap\s*.*)/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;

    var arr = match[1].trim().toLowerCase();
    var list = arr.split(/\s+/);
    if(list.length === 1) return {text: currentOtherUsernames[~~(currentOtherUsernames.length * Math.random())] + " just got slapped."};

    var name = list[1];
    if(name === "me") return {text: currentUsername + " just go slapped." + (Math.random() > 0.5 ? " Hard.": "")};

    var exists = currentOtherUsernames.filter(function(v) {return v === name;}).length === 1;

    return {text: capitalize(name) + " just got slapped." + (Math.random() > 0.5 ? " Hard.": "")};
  };

  var weekendText = function(msg) {
    var myRegexp = /is it (weekend)\s?\?/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;
    var today = new Date();
    return {text: (today.getDay() === 0 || today.getDay() === 6 ? "YES" : "NO")};
  };

  var addScore = function(msg) {
    var myRegexp = /^(.+)\+\+/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;
    var name = match[1].trim().toLowerCase();

    name = capitalize(name);
    if (name === currentUsername) {
      return {text: name + ", you can't upvote yourself -_- "};
    }
    if (contains(currentOtherUsernames, name)) {
      var score = (currentChat.scores[name] ? currentChat.scores[name] : 0) + 1;
      currentChat.scores[name] = score;
      return {text: name + "'s score is now " + score + "."};
    }

    return {text: "Who's " + name + "?"};
  };

  var salute = function(msg) {
      var myRegexp = /general\s+(\w+)/i;
      var match = myRegexp.exec(msg);
      if (!match || match.length < 1) return;

      var general = match[1].trim();
      return {text: ("*salute* General " + general)};
  };

  var score = function(msg) {
    var myRegexp = /^\/score([\w .\-]*)$/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;
    var name = match[1].trim().toLowerCase();
    if (name.length < 1 || name === "me") name = currentUsername;

    name = capitalize(name);
    if (!contains(currentOtherUsernames, name)) return {text: "who?"};

    var pts = currentChat.scores[name] ? currentChat.scores[name] : 0;
    return {text: ("" + name + " has " + pts + " points")};
  };

  var albert = function(msg) {
    var myRegexp = /^\/albert$/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;
    var k =  "\n         ,---,_          ,\n          _>   `'-.  .--'/\n     .--'` ._      `/   <_\n      >,-' ._'.. ..__ . ' '-.\n   .-'   .'`         `'.     '.\n    >   / >`-.     .-'< \\ , '._\\\n   /    ; '-._>   <_.-' ;  '._>\n   `>  ,/  /___\\ /___\\  \\_  /\n   `.-|(|  \\o_/  \\o_/   |)|`\n       \\;        \\      ;/\n         \\  .-,   )-.  /\n          /`  .'-'.  `\\\n         ;_.-`.___.'-.;\n";
    return {text: k};
  };

  var bees = function(msg) {
    if (msg.indexOf("bees") > -1) {
      return {text: "http://cdn.gifstache.com/2012/7/19/gifstache.com_893_1342731571.gif"};
    }
  };

  var sexxiBatman = function(msg) {
    if (msg.match(/[Ww]anna make some trouble[\s\t]*/)) {
      return {text: "http://99gifs.com/-img/514e8830afa96f09940128f8.gif"};
    }
  };

  var ping = function(msg) {
    var myRegexp = /^\/ping$/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;
    return {text: "pong"};
  };

  var xkcdSearch = function(msg) {
    var myRegexp = /^\/xkcd\s+(.+)/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;
    var search = match[1].trim().toLowerCase().replace(/ /g, "+");
    var searchUrl = "http://derp.co.uk/xkcd/page?q=" + search + "&search=Search";
    return {text: "Find relevant xkcds here: " + searchUrl};
  };

  var giphySearch = function(msg) {
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
          return {text: data};
        } else {
          return {text: "No gif for this search result."};
        }
      };

      request.onerror = function() {
        console.log('Connection error');
      };

      request.send(null);
      console.log("request sent");
    }
  };

  var arbitraryLists = function (msg) {
    var myRegexp = /^\/(list\s*.*)/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;

    var list = match[1].trim().toLowerCase();
    var arr = list.split(/\s+/);
    if(arr.length === 1) return {text: (Object.keys(currentChat.lists).length > 0 ? "Existing Lists: \n" + Object.keys(currentChat.lists).map(function(v, i) {
      return (i + 1) + " - " + v;
    }).join("\n") : "No existing list.")};

    var keyword = arr[1];
    var listName = arr.length > 2 ? arr[2] : "";
    if(keyword === 'new') {
      if(listName.length > 0) {
        currentChat.lists[listName] = [];
        return {text: "List '" + listName + "' created."};
      }
    } else if (keyword === 'delete') {
      if(arr.length > 3) {
        var num = parseInt(arr[3]);
        if(num - 1 >= currentChat.lists[listName].length || num - 1 < 0) {
          return {text: "Item " + num + " in list '" + listName + "' doesn't exist."};
        }
        currentChat.lists[listName].splice(num - 1, 1);
        return {text: "Item " + num + " in list '" + listName + "' deleted."};
      }
      if(listName.length > 0) {
        delete currentChat.lists[listName];
        return {text: "List '" + listName + "' deleted."};
      }
    } else if (keyword === 'add') {
      if(listName.length > 0 && arr.length > 3) {
        if (!currentChat.lists[listName]) {
          return {text: "No list of name '"+listName+"' exists."};
        }
        currentChat.lists[listName].push(arr.slice(3).join(' '));
        return {text: "Added '" + arr.slice(3).join(' ') + "' to " + listName + "."};
      }
    } else if (currentChat.lists[keyword]) {
      return {text: keyword + ": \n" + currentChat.lists[keyword].map(function(v, i) {return (i + 1) + " - " + v;}).join("\n")};
    }

    return {text: "Usage:\n /list \n /list list-name\n /list new list-name \n /list delete list-name \n /list add list-name new-element"};
  };

  var topScore = function(msg) {
    var myRegexp = /^\/(topscores?)$/i;
    var match = myRegexp.exec(msg);
    if (!match || match.length < 1) return;
    var max = -1;
    var maxName = "";
    for (var i = 0; i < currentOtherUsernames.length; i++) {
      var score = currentChat.scores[currentOtherUsernames[i]] ? currentChat.scores[currentOtherUsernames[i]] : 0;
      if (score > max) {
        max = score;
        maxName = currentOtherUsernames[i];
      }
    }
    return {text: "Top Score: " + maxName+ ", with "+max+" points."};
  };

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

  var timezonesOffsets = {"A":60,"ACDT":630,"ACST":570,"ADT":-180,"AEDT":660,"AEST":600,"AFT":270,"AKDT":-480,"AKST":-540,"ALMT":360,"AMST":-180,"AMT":-240,"ANAST":720,"ANAT":720,"AQTT":300,"ART":-180,"AST":-240,"AWDT":540,"AWST":480,"AZOST":0,"AZOT":-60,"AZST":300,"AZT":240,"B":120,"BNT":480,"BOT":-240,"BRST":-120,"BRT":-180,"BST":60,"BTT":360,"C":180,"CAST":480,"CAT":120,"CCT":390,"CDT":-300,"CEST":120,"CET":60,"CHADT":825,"CHAST":765,"CKT":-600,"CLST":-180,"CLT":-240,"COT":-300,"CST":-360,"CVT":-60,"CXT":420,"ChST":600,"D":240,"DAVT":420,"E":300,"EASST":-300,"EAST":-360,"EAT":180,"ECT":-300,"EDT":-240,"EEST":180,"EET":120,"EGST":0,"EGT":-60,"EST":-300,"ET":-300,"F":360,"FJST":780,"FJT":720,"FKST":-180,"FKT":-240,"FNT":-120,"G":420,"GALT":-360,"GAMT":-540,"GET":240,"GFT":-180,"GILT":720,"GMT":0,"GST":240,"GYT":-240,"H":480,"HAA":-180,"HAC":-300,"HADT":-540,"HAE":-240,"HAP":-420,"HAR":-360,"HAST":-600,"HAT":-90,"HAY":-480,"HKT":480,"HLV":-210,"HNA":-240,"HNC":-360,"HNE":-300,"HNP":-480,"HNR":-420,"HNT":-150,"HNY":-540,"HOVT":420,"I":540,"ICT":420,"IDT":180,"IOT":360,"IRDT":270,"IRKST":540,"IRKT":540,"IRST":210,"IST":60,"JST":540,"K":600,"KGT":360,"KRAST":480,"KRAT":480,"KST":540,"KUYT":240,"L":660,"LHDT":660,"LHST":630,"LINT":840,"M":720,"MAGST":720,"MAGT":720,"MART":-510,"MAWT":300,"MDT":-360,"MESZ":120,"MEZ":60,"MHT":720,"MMT":390,"MSD":240,"MSK":240,"MST":-420,"MUT":240,"MVT":300,"MYT":480,"N":-60,"NCT":660,"NDT":-90,"NFT":690,"NOVST":420,"NOVT":360,"NPT":345,"NST":-150,"NUT":-660,"NZDT":780,"NZST":720,"O":-120,"OMSST":420,"OMST":420,"P":-180,"PDT":-420,"PET":-300,"PETST":720,"PETT":720,"PGT":600,"PHOT":780,"PHT":480,"PKT":300,"PMDT":-120,"PMST":-180,"PONT":660,"PST":-480,"PT":-480,"PWT":540,"PYST":-180,"PYT":-240,"Q":-240,"R":-300,"RET":240,"S":-360,"SAMT":240,"SAST":120,"SBT":660,"SCT":240,"SGT":480,"SRT":-180,"SST":-660,"T":-420,"TAHT":-600,"TFT":300,"TJT":300,"TKT":780,"TLT":540,"TMT":300,"TVT":720,"U":-480,"ULAT":480,"UTC":0,"UYST":-120,"UYT":-180,"UZT":300,"V":-540,"VET":-210,"VLAST":660,"VLAT":660,"VUT":660,"W":-600,"WAST":120,"WAT":60,"WEST":60,"WESZ":60,"WET":0,"WEZ":0,"WFT":720,"WGST":-120,"WGT":-180,"WIB":420,"WIT":540,"WITA":480,"WST":780,"WT":0,"X":-660,"Y":-720,"YAKST":600,"YAKT":600,"YAPT":600,"YEKST":360,"YEKT":360,"Z":0};
}

// Main function
db.once('value', function(snapshot) {
  var chats = snapshot.val() || {};
  login(function(err, api) {
    if(err) return console.error(err);

    startBot(api, chats);
  });
});