<html>
<head>
  <meta name="robots" content="noindex">
  <meta charset="utf-8">
  <meta name="generator" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
 <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js"></script>
 <script src="/test14/retort/game.js?v=<?=time();?>"></script>
 <script src="server.js?v=<?=time();?>"></script>
 <title></title>
 <style>
    ::-webkit-scrollbar {
      display: none;
    }
    
    body {
      background-color: black !important;
      zoom: 175%;
    }
    
    #divchatbot {
      width: 100%;
      text-align: center;
      padding: 10px 0;
      background-color: #000000;
    }
    
    #chatbotcontainer {
      border-style: solid;
      position: fixed;
      bottom: 10px;
      left: 20%;
      right: 20%;
      text-align: center;
      z-index: 1000;
      background-color: #000000;
      visibility: visible;
      height: 100%;
      overflow-y: scroll;
    }
    
    #chatlog {
      width: 95%;
      color: #ffffff;
      word-wrap: break-word;
    }
    
    #chatuserinput {
      font-size: 20px;
      width: 90%;
      word-wrap: break-word;
      height: auto;
      max-height: 500px;
      overflow-y: auto;
      resize: vertical;
    }
    
    #chatbuttons {
      justify-content: space-around;
      margin-bottom: 10px;
    }
    
    #chatbotbutton {
      font-size: 14px;
      padding: 5px 10px;
    }
    
    .npc-data {
  overflow-wrap: break-word;
}
</style>
<script>
  // Move the function declarations to the global scope

  // Function to scroll to the bottom of the chat log
  function scrollToBottom() {
    var chatbotButton = document.getElementById("chatbotbutton");
    chatbotButton.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  // Function to update the chat log with new content
  function updateChatLog(newContent) {
    var chatLog = document.getElementById("chatlog");
    chatLog.innerHTML += newContent;
    scrollToBottom();
  }


</script>
</head>
<body>
  <div id="divchatbot">
    <div id="chatbotcontainer">
      <p id="chatlog" align="left"><br><img src="./children-of-the-grave-logo.png" style="width:50%; text-align:center;"><br><img src="./SceneBreak.png" style="width:50%; text-align:center;"><br><br><b>Grave Master:</b> Hello, adventurer! Welcome to Children of the Grave: Version 1.0, a GPT-3 and Open AI powered fantasy roleplaying text adventure game. I am the Grave Master, who administers the game. And you are the player.<br><br>CHILDREN OF THE GRAVE: Version 1.0<br><br>You find yourself standing in the first room of the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels and powerful demons...<br><br>The game begins in the Ruined Temple. Good luck, adventurer! Type 'Start. Construct the 1000 rooms. Display start menu.' with nothing else in the sentence and then choose a game mode from the start menu.</p>
      <div id="game-console">
  <table class="character-table" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td class="character-column" style="width: 14%; font-size: 8pt; color: white;">
        <script>displayPCData(charactersString);</script>
      </td>
      <td class="character-column" style="width: 14%; font-size: 8pt; color: white;">
        <script>displayAllNPCData(npcsString, 0);</script>
      </td>
      <td class="character-column" style="width: 14%; font-size: 8pt; color: white;">
          <script>displayAllNPCData(npcsString, 1);</script>
      </td>
      <td class="character-column" style="width: 14%; font-size: 8pt; color: white;">
          <script>displayAllNPCData(npcsString, 2);</script>
      </td>
      <td class="character-column" style="width: 14%; font-size: 8pt; color: white;">
          <script>displayAllNPCData(npcsString, 3);</script>
      </td>
      <td class="character-column" style="width: 14%; font-size: 8pt; color: white;">
          <script>displayAllNPCData(npcsString, 4);</script>
      </td>
      <td class="character-column" style="width: 14%; word-wrap: break-word; font-size: 8pt; color: white;">
          <script>displayAllNPCData(npcsString, 5);</script>
      </td>
    </tr>
  </table>
</div>
      <p align="left" style="width: 95%; word-wrap: break-word;"><textarea id="chatuserinput" align="left" placeholder="Type a command" onkeydown="if (event.keyCode == 13) { event.preventDefault(); chatbotprocessinput(); }  ;  if (event.keyCode == 38) { repeatuser(); }" style="width: 100%; min-height: 30px; max-height: 120px; resize: vertical;">start</textarea>
      </p>
      <div id="chatbuttons"><p align="left">
        <button type="button" onclick="chatbotprocessinput()" id="chatbotbutton">Command</button></p>
          <button type="button" onclick="document.getElementById('divchatbot').style.visibility = 'hidden' ; document.getElementById('divchatbotoff').style.visibility = 'visible'" title="" style="visibility:hidden;" id="chatbotbutton"><font size=4>Close</font></button></p>

      </div>
    </div>
  </div>

  <div style="display: none;"><b>Your API key (remains hidden to me): </b><input id="userapikey" value=""/></div>
</body>
</html>

