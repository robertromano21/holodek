function clearAllCookies() {
  // Retrieve all cookies and split into individual cookies
  const cookies = document.cookie.split(";");

  // Loop through each cookie and delete by setting expiry to the past
  for (let cookie of cookies) {
      const eqPos = cookie.indexOf("=");
      const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
      document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  }
}

// Run this function on page load or when initializing the session
window.onload = clearAllCookies;

// generate a random ID for a conversation
function generateConversationId() {
return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const dbName = 'myDatabase';
const request = window.indexedDB.open(dbName, 1);
let db;

request.onerror = function(event) {
console.error("Database error: ", event.target.errorCode);
};

request.onsuccess = function(event) {
console.log("Database opened successfully");
db = event.target.result;
};

request.onupgradeneeded = function(event) {
const db = event.target.result;
const store = db.createObjectStore('conversation', {keyPath: 'id', autoIncrement:true});
store.createIndex('conversationId', 'conversationId', {unique: false});
};


// get all prompts and responses from the database for a given conversation ID
function getPromptsAndResponsesForConversation(conversationId) {
return new Promise((resolve, reject) => {
  const transaction = db.transaction(['conversation'], 'readonly');
  const store = transaction.objectStore('conversation');
  const index = store.index('conversationId');
  const request = index.getAll(IDBKeyRange.only(conversationId));
  request.onsuccess = function(event) {
    resolve(event.target.result);
  };
  request.onerror = function(event) {
    reject("Error getting prompts and responses for conversation");
  };
});
}

// Map to store room conversation histories based on coordinates
const roomConversationHistories = {};
let roomEquipment = [];

// Function to save a room's conversation history on a per-coordinate basis
function saveRoomConversationHistory(coordinates, roomHistory, roomEquipment, objectMetadata) {
const coordinatesString = coordinatesToString(coordinates);

if (!roomConversationHistories[coordinatesString]) {
  roomConversationHistories[coordinatesString] = [];
}

// Exclude lines containing specific keywords and meeting specified conditions
const excludedKeywords = ["Current Game Information:", "Updated Game Information", "Seed:", "Room Description:", "Coordinates:", "Objects in Room:", "Exits:", "XP:", "Score:", "Artifacts Found:", "Quests Achieved:", "HP:", "Inventory:", "PC:", "NPCs:", "Rooms Visited:", "Turns:", "north", "south", "east", "west", "northeast", "southeast", "northwest", "southwest", "down"];

const filteredSentences = roomHistory.response
  .split(/[.!?]/) // Split into sentences based on . ! or ?
  .map(sentence => sentence.trim()) // Trim whitespace from each sentence
  .filter(sentence => {
    const trimmedLine = sentence.trim();
    if (excludedKeywords.some(keyword => trimmedLine.includes(keyword))) {
      if (/[.?!]$/.test(trimmedLine) && !trimmedLine.includes('"') && trimmedLine.endsWith('?')) {
        // Line ends with a question mark and is not contained within quotation marks
        const hasExcludedKeyword = excludedKeywords.some(keyword => sentence.includes(keyword));
        return !hasExcludedKeyword;
      } else {
        // Line doesn't meet the criteria, remove entire line
        return false; // Return false to filter out this sentence
      }
    }
    return true; // Keep the sentence if no excluded keywords are found
  });

const filteredRoomHistory = filteredSentences.join(". "); // Join filtered sentences with a period

const filteredRoomEquipment = roomEquipment.join(", "); // Convert roomEquipment to a string

roomConversationHistories[coordinatesString].push({
  prompt: prompt,
  response: filteredRoomHistory,
  roomEquipment: filteredRoomEquipment,
  objectMetadata: objectMetadata,// Store roomEquipment in the history entry
});
}


// Function to retrieve the first response in a room's conversation history based on coordinates
function getFirstResponseForRoom(coordinates) {
const coordinatesString = coordinatesToString(coordinates);

const roomHistory = roomConversationHistories[coordinatesString];

if (roomHistory && roomHistory.length > 0) {
  return roomHistory[0];
}

return null;
}

function updateRoomConversationFirstResponse(coordinates, serverGameConsole) {
  const coordinatesString = coordinatesToString(coordinates);

  if (!roomConversationHistories[coordinatesString]) {
      roomConversationHistories[coordinatesString] = [];
  }

  if (serverGameConsole) {
      // Safely extract room details from serverGameConsole
      const roomName = serverGameConsole.match(/Room Name: (.*?)\s*$/m)?.[1]?.trim();
      let roomHistory = serverGameConsole.match(/Room Description: (.*?)\s*$/m)?.[1]?.trim();
      const roomEquipmentString = serverGameConsole.match(/Objects in Room: (.*?)\s*$/m)?.[1]?.trim();
      const roomEquipment = roomEquipmentString ? roomEquipmentString.split(', ').map(item => item.trim()) : [];
      const objectMetadata = serverGameConsole.match(/Objects in Room Properties: (.*?)\s*$/m)?.[1]?.trim();
/*   if (objectPropertiesMatch) {
      try {
          objectMetadata = JSON.parse(objectPropertiesMatch[1]);
      } catch (e) {
          console.error("Failed to parse object properties:", e);
      }
  }*/
   //   const monstersInRoom = serverGameConsole.match(/Monsters in Room: ([\s\S]+?)(?=Rooms Visited:)/);
      console.log(roomName);
      console.log(objectMetadata);
   //   console.log(monstersInRoom);

      // Define excluded keywords for cleanup
      const excludedKeywords = [
          "Current Game Information:", "Updated Game Information", "Seed:",
          "Room Description:", "Coordinates:", "Objects in Room:", "Objects in Room Properties:", "Exits:",
          "XP:", "Score:", "Artifacts Found:", "Quests Achieved:", "HP:",
          "Inventory:", "PC:", "NPCs:", "Rooms Visited:", "Turns:",
          "north", "south", "east", "west", "northeast", "southeast",
          "northwest", "southwest"
      ];

      // Remove excluded keywords from roomHistory if it's defined
      if (roomHistory) {
          excludedKeywords.forEach(keyword => {
              const regex = new RegExp(`${keyword}.*`, 'gi'); // Match the keyword and everything after it
              roomHistory = roomHistory.replace(regex, '').trim(); // Replace with empty and trim
          });

          // Remove line breaks and clean up spaces
          roomHistory = roomHistory.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      }

      // Create a new conversation history entry with server game console details
      const newConversationEntry = {
          prompt: "",  // Add your actual prompt logic here
          response: "",
          roomEquipment,
          objectMetadata,
          roomName,
          roomHistory,
          monstersInRoom
      };

      // Check if there's already a conversation history for these coordinates
      if (roomConversationHistories[coordinatesString].length > 0) {
          // Update the first entry
          roomConversationHistories[coordinatesString][0] = newConversationEntry;
      } else {
          // Add new entry if no history exists
          roomConversationHistories[coordinatesString].push(newConversationEntry);
      }
  }
}


// add a prompt, assistant prompt, system prompt, response, and personal narrative to the database
function addPromptAndResponse(prompt, assistantPrompt, systemPrompt, response, personalNarrative, conversationId, gameConsole) {
const transaction = db.transaction(['conversation'], 'readwrite');
const store = transaction.objectStore('conversation');

// Format the prompt and response
const formattedPrompt = `$.user \`${prompt}\``;
const formattedResponse = `$.assistant \`${response}\``;

const newPromptAndResponse = {
  prompt: formattedPrompt,
  assistantPrompt: `$.assistant \`${assistantPrompt}\``, // Format if necessary
  systemPrompt: `$.system \`${systemPrompt}\``, // Format if necessary
  response: formattedResponse,
  personalNarrative: `personalNarrative \`${personalNarrative}\``, // Format if you're storing this as a single entry
  conversationId: conversationId,
  gameConsole: gameConsole,
};

store.add(newPromptAndResponse);

// Extract room equipment from gameConsole
const roomEquipment = gameConsole.match(/Objects in Room: ([^\n]+)/) ? gameConsole.match(/Objects in Room: ([^\n]+)/)[1].split(", ") : [];

// Extract objectMetadata from gameConsole
const objectMetadata = gameConsole.match(/Objects in Room Properties: ([^\n]+)/) ? gameConsole.match(/Objects in Room Properties: ([^\n]+)/)[1].split(", ") : [];

// Define the conversationHistory here
const roomHistory = {
  prompt: prompt,
  response: response,
  roomEquipment: roomEquipment,
  objectMetadata: objectMetadata, // Include objectMetadata in roomHistory
  prompts: [] // Add an array to store user prompts
};

// Push the user prompt into the prompts array
roomHistory.prompts.push(prompt);

// Save the conversation history in the room's conversation histories
saveRoomConversationHistory(currentCoordinates, roomHistory, roomEquipment, objectMetadata); // Save with objectMetadata


// If the room's conversation history entry doesn't exist yet, create it
const coordinatesString = coordinatesToString(currentCoordinates);
if (!roomConversationHistories[coordinatesString]) {
  roomConversationHistories[coordinatesString] = [];
}

// Save the conversation history in the room's conversation histories
roomConversationHistories[coordinatesString].push(roomHistory);

// Log all prompts, assistant prompt, system prompt, response, and personal narrative in the console
getPromptsAndResponsesForConversation(conversationId)
  .then((promptsAndResponses) => {
    console.log("All prompts, assistant prompt, system prompt, response, and personal narrative for conversation " + conversationId + ":", promptsAndResponses);
  })
  .catch((error) => {
    console.error(error);
  });
}


// Initialize the currentCoordinates to the starting point
let currentCoordinates = { x: 0, y: 0, z: 0 };

var turns = 0;

// Map single-letter directions to their full names
const directionMap = {
'n': 'north',
's': 'south',
'e': 'east',
'w': 'west',
'nw': 'northwest',
'sw': 'southwest',
'ne': 'northeast',
'se': 'southeast',
'u': 'up',
'd': 'down',
};

// Function to find a matching console in the conversation history based on coordinates
function findMatchingConsoleByCoordinates(conversationHistory, coordinates) {
const regex = new RegExp(`Coordinates: X: ${coordinates.x}, Y: ${coordinates.y}, Z: ${coordinates.z}`);
const matches = conversationHistory.match(regex);
return matches ? matches[0] : null;
}


// Keep track of visited room coordinates
const visitedRooms = new Set();

// Data structure to store room connections
const roomConnections = {};

// Set to keep track of connected and unconnected rooms
const connectedRooms = new Set();
const unconnectedRooms = new Set();

// Function to generate unique exits for a room based on its coordinates
function generateUniqueExits(coordinates, updatedGameConsole) {
// For demonstration purposes, let's assume that the exits are randomly generated.
// You should replace this with your actual exit generation logic.
const possibleExits = ["north", "south", "east", "west", "northeast", "southeast", "northwest", "southwest", "up", "down"];
const numExits = Math.min(Math.floor(Math.random() * 5) + 1, 5); // Random number of exits (1 to 3)
const exits = new Set();

// Get the most recent visited room's coordinates from the Set
const recentCoordinates = Array.from(visitedRooms).pop();

console.log('recentCoordinates:', recentCoordinates); // Log recentCoordinates every turn

if (recentCoordinates) {
  // Determine the direction the player moved from the most recent coordinates to the updated coordinates
  const { x: prevX, y: prevY, z: prevZ } = recentCoordinates;
  const { x: currX, y: currY, z: currZ } = coordinates;

  // Determine the direction the player moved from the most recent coordinates to the updated coordinates
  const xDiff = currX - prevX;
  const yDiff = currY - prevY;
  const zDiff = currZ - prevZ;

  // Add the opposite direction of the player's movement to exits
  if (xDiff > 0 && yDiff === 0 && zDiff === 0) exits.add("west");
  else if (xDiff < 0 && yDiff === 0 && zDiff === 0) exits.add("east");

  else if (xDiff === 0 && yDiff > 0 && zDiff === 0) exits.add("south");
  else if (xDiff === 0 && yDiff < 0 && zDiff === 0) exits.add("north");
  // Additional diagonal directions
  else if (xDiff > 0 && yDiff > 0 && zDiff === 0) exits.add("southwest");
  else if (xDiff > 0 && yDiff < 0 && zDiff === 0) exits.add("northwest");
  else if (xDiff < 0 && yDiff > 0 && zDiff === 0) exits.add("southeast");
  else if (xDiff < 0 && yDiff < 0 && zDiff === 0) exits.add("northeast");
  else if (xDiff === 0 && yDiff === 0 && zDiff > 0) exits.add("down");
  else if (xDiff === 0 && yDiff === 0 && zDiff < 0) exits.add("up");

}

// Get an array of visited room coordinates
const visitedRoomCoordinates = Array.from(visitedRooms);

console.log("Visited Room Coordinates:", visitedRoomCoordinates);

// Convert visited room coordinates to a Set of strings
const visitedRoomCoordinatesSet = new Set(visitedRoomCoordinates.map(coord => coordinatesToString(coord)));

// Get potential exits that haven't been visited
const potentialExits = possibleExits.filter(exitDirection => {
const adjacentCoord = generateCoordinates(currentCoordinates, exitDirection);
const adjacentCoordString = coordinatesToString(adjacentCoord);
return !visitedRoomCoordinatesSet.has(adjacentCoordString);
});

console.log("Potential Exits:", potentialExits);

// Add at least one random exit to the set
const initialExitIndex = Math.floor(Math.random() * potentialExits.length);
const initialExit = potentialExits[initialExitIndex];
exits.add(initialExit);
console.log("Exits:", exits)

// Add random exits to the set
while (exits.size < numExits && potentialExits.length > 0) {
const randomExitIndex = Math.floor(Math.random() * potentialExits.length);
const randomExit = potentialExits[randomExitIndex];

exits.add(randomExit);
potentialExits.splice(randomExitIndex, 1); // Remove the used exit from potentialExits
}

console.log("Exits:", exits)

// Check if the roomConnections entry doesn't exist for the current room
if (!roomConnections[coordinatesToString(currentCoordinates)]) {
roomConnections[coordinatesToString(currentCoordinates)] = {
  coordinates: currentCoordinates,
  exits: [],
  connectedRooms: [],
  unconnectedRooms: Array.from(getAdjacentCoordinates(currentCoordinates)) // Initialize as an array
};
}

// Determine potentially adjacent coordinates
const adjacentCoordinates = getAdjacentCoordinates(currentCoordinates);
  // Update the roomConnections data structure
  roomConnections[coordinatesToString(currentCoordinates)].exits = exits;

  exits.forEach(exit => {
    const adjacentCoord = generateCoordinates(currentCoordinates, exit);
    if (!roomConnections[coordinatesToString(adjacentCoord)]) {
      roomConnections[coordinatesToString(adjacentCoord)] = {
        coordinates: adjacentCoord,
        exits: [],
        connectedRooms: [],
        unconnectedRooms: getAdjacentCoordinates(adjacentCoord) // Get all potential adjacent coordinates
      };
    }
    roomConnections[coordinatesToString(currentCoordinates)].connectedRooms.push(adjacentCoord);
    roomConnections[coordinatesToString(adjacentCoord)].connectedRooms.push(currentCoordinates);

// Remove the adjacent room from the unconnected rooms set
roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms = Array.from(roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms).filter(room =>
!areObjectsEqual(room, adjacentCoord)
);
roomConnections[coordinatesToString(adjacentCoord)].unconnectedRooms = Array.from(roomConnections[coordinatesToString(adjacentCoord)].unconnectedRooms).filter(room =>
!areObjectsEqual(room, currentCoordinates)
);
  });

  // Remove the current room from the unconnected rooms set
  roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms = roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms.filter(room =>
    !areObjectsEqual(room, currentCoordinates)
  );



// Update roomConnections based on exits
exits.forEach(exit => {
const adjacentCoord = generateCoordinates(currentCoordinates, exit);
if (adjacentCoordinates.has(adjacentCoord)) {
  if (!roomConnections[adjacentCoord]) {
    roomConnections[adjacentCoord] = {
      coordinates: adjacentCoord,
      connectedRooms: [],
      unconnectedRooms: []
    };
  }
  roomConnections[currentCoordinates].connectedRooms.push(adjacentCoord);
  roomConnections[adjacentCoord].connectedRooms.push(currentCoordinates);
  
  // Remove adjacentCoord from the unconnectedRooms of currentCoordinates
  roomConnections[currentCoordinates].unconnectedRooms.delete(adjacentCoord);

  // Remove currentCoordinates from the unconnectedRooms of adjacentCoord
  roomConnections[adjacentCoord].unconnectedRooms.delete(currentCoordinates);
}
});

// Get the connected and unconnected rooms of the current coordinates
const connectedRoomsOfCurrent = roomConnections[coordinatesToString(coordinates)].connectedRooms;
const unconnectedRoomsOfCurrent = roomConnections[coordinatesToString(coordinates)].unconnectedRooms;
console.log("Connected Rooms: ", connectedRoomsOfCurrent)

// Add exits that lead to connected rooms
for (const room of connectedRoomsOfCurrent) {
  const exitToConnected = getExitToCoordinate(coordinates, room);
  if (exitToConnected) {
    exits.add(exitToConnected);
  }
}
console.log(`Generated exits for coordinates (${coordinates.x}, ${coordinates.y}, ${coordinates.z}): ${Array.from(exits)}`);
console.log("Exits:", exits)
return Array.from(exits);
}



// Function to get the exit direction from one coordinate to another
function getExitToCoordinate(fromCoordinate, toCoordinate) {
const offsets = [
  { offset: { x: 0, y: 1, z: 0 }, direction: "north" },
  { offset: { x: 0, y: -1, z: 0 }, direction: "south" },
 { offset: { x: 1, y: 0, z: 0 },  direction: "east" },
 { offset: { x: -1, y: 0, z: 0 }, direction: "west" },
 { offset: { x: 1, y: 1, z: 0 },  direction: "northeast" },
 { offset: { x: -1, y: 1, z: 0 }, direction: "northwest" },
 { offset: { x: 1, y: -1, z: 0 }, direction: "southeast" },
 { offset: { x: -1, y: -1, z: 0 }, direction: "southwest" },
 { offset: { x: 0, y: 0, z: 1 },  direction: "up" },
 { offset: { x: 0, y: 0, z: -1 }, direction: "down" },
  // ... repeat for other directions
];

for (const { offset, direction } of offsets) {
  const adjacentCoord = {
    x: fromCoordinate.x + offset.x,
    y: fromCoordinate.y + offset.y,
    z: fromCoordinate.z + offset.z,
  };

  if (areCoordinatesEqual(adjacentCoord, toCoordinate)) {
    return direction;
  }
}

return null; // No exit in this direction
}

// Function to check if two coordinates are equal
function areCoordinatesEqual(coord1, coord2) {
return coord1.x === coord2.x && coord1.y === coord2.y && coord1.z === coord2.z;
}

// Function to generate new coordinates based on the valid direction
function generateCoordinates(currentCoordinates, validDirection) {
// Convert the validDirection to its full name if it exists in the directionMap
const direction = directionMap[validDirection] || validDirection;

let { x, y, z } = currentCoordinates;

if (direction === 'north') {
  y++;
} else if (direction === 'south') {
  y--;
} else if (direction === 'east') {
  x++;
} else if (direction === 'west') {
  x--;
} else if (direction === 'northwest') {
  x--;
  y++;
} else if (direction === 'southwest') {
  x--;
  y--;
} else if (direction === 'northeast') {
  x++;
  y++;
} else if (direction === 'southeast') {
  x++;
  y--;
} else if (direction === 'up') {
  z++;
} else if (direction === 'down') {
  z--;
}

return { x, y, z };
}


const equipmentItems = ["candle", "candles", "torch", "oil flask", "flint & steel", "holy symbol", "holy water", "lock pick", "pouch of lock picks (20)", "key", "rope 50 ft.", "salt", "book", "journal", "diary", "tome", "parchment", "scroll", "spellbook", "paper", "canvas", "miner's pick", "poison (vial)", "pouch", "robes", "shovel", "helmet", "club", "dagger", "dagger +1", "knife", "greatclub", "handaxe", "javelin", "lance", "hammer", "mace", "morning star", "quarterstaff", "sickle", "spear", "crossbow", "darts (20)", "shortbow", "arrows (20)", "darts", "sling", "staff sling", "battleaxe", "flail", "glaive", "greataxe", "greatsword", "halberd", "lance", "longsword", "longsword +1", "longsword +2", "longsword +3", "scimitar", "broad sword", "two-handed sword", "two-handed sword +1", "two-handed sword +2", "two-handed sword +3", "maul", "morningstar", "pike", "rapier", "scimitar", "shortsword", "shortsword +1", "shortsword +2", "trident", "war pick", "warhammer", "whip", "scourge", "blowgun", "longbow", "net", "banded mail", "banded mail +1", "chain mail", "chain mail +1", "chain mail +3", "plate mail", "plate mail +1", "plate mail +2", "plate mail +3", "leather armor", "padded armor", "suit of armor", "armor", "ring mail", "scale mail", "shield", "studded leather armor", "splint mail", "bracers", "adamantine armor", "backpack", "sheath", "sack", "crystal", "vial", "healing potion", "potion of healing", "orb", "rod", "staff", "wand", "totem", "wooden staff", "wand of fireballs", "wand of magic missiles", "wand of ice storm", "wand of lightning", "alchemist's fire flask", "amulet", "locket", "lantern", "chest", "wooden box", "jug", "pot", "flask", "waterskin", "rations", "drum", "flute", "lute", "lyre", "horn", "pan flute", "paint brush", "saddle", "ale", "bread", "meat", "bottle of wine", "goblet", "cup", "chalice", "gold pieces", "silver pieces", "copper pieces", "platinum pieces", "gem", "jewelry", "ring", "amulet of health", "amulet of the planes", "arrow of slaying", "bag of holding", "girdle of giant strength", "berserker axe", "boots of speed", "broom", "satchel", "candle of invocation", "cloak of displacement", "cloak of protection", "crystal ball", "dragon scale mail", "dust of disappearance", "dwarven plate", "elemental gem", "elven chain mail", "feather", "figurine", "flame tongue sword", "gem of brightness", "giant slayer", "hammer of thunderbolts", "ioun stone", "javelin of lightning", "mithral armor", "necklace of missiles", "potion of animal friendship", "potion of giant strength", "potion of invisibility", "potion of resistance", "potion of speed", "ring of protection", "ring of fire", "ring of water", "ring of earth", "ring of air", "ring of invisibility", "ring of resistance", "ring of telekinesis", "robe of the archmagi", "shield +1", "shield +2", "shield +3", "scimitar of speed", "staff of fire", "staff of healing", "staff of the magi", "staff of thunder & lightning", "wand of fear", "wand of paralysis",  /* other equipment items */];

// Function to escape special characters in a string for use in a regular expression
function escapeRegExp(string) {
return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Array to store player's inventory
let inventory = [];
function removeNoneFromInventory(inventory) {
// Remove "None" and "None " if they exist in the inventory array
inventory = inventory.filter(item => item.trim() !== "None" && item.trim() !== "None ");
return inventory;
}

// Define experienceToAdd
const experienceToAdd = getRandomInt(10000, 50000);

// Define a map to store generated monsters in visited rooms
const monstersInVisitedRooms = new Map();

// Function to calculate XP based on character level
function calculateXP(level) {
return level * 15000;
}

function generateMonstersForRoom(roomCoordinates, serverGameConsole) {
  if (!monstersInVisitedRooms.has(roomCoordinates)) {
      let monsters = [];

      // Update regex to ensure it captures the entire monsters section properly
      const monsterDataMatch = serverGameConsole.match(/Monsters in Room:([\s\S]+?)(?=Rooms Visited:|$)/);
      if (monsterDataMatch) {
          // Correctly split monster entries by looking for two consecutive newlines or start of a new monster entry
          const monsterEntries = monsterDataMatch[1].trim().split(/\n(?=\w)/);
          monsters = monsterEntries.map(monsterBlock => {
              const lines = monsterBlock.split('\n').map(line => line.trim());
              if (lines.length < 9) {
                  console.error("Unexpected format in monsterBlock:", lines);
                  return null; // Skip improperly formatted blocks
              }
              return {
                  Name: lines[0],
                  Sex: lines[1],
                  Race: lines[2],
                  Class: lines[3],
                  Level: parseInt(lines[4].split(' ')[1]),
                  AC: parseInt(lines[5].split(' ')[1]),
                  XP: parseInt(lines[6].split(' ')[1]),
                  HP: parseInt(lines[7].split(' ')[1]),
                  MaxHP: parseInt(lines[8].split(' ')[1])
              };
          }).filter(Boolean); // Remove any null entries

          monstersInVisitedRooms.set(roomCoordinates, monsters);
      } else {
          console.log("No monster data found or regex failed to match.");
      }
  }
}

// Helper function to parse monsters from the string
function parseMonsters(monstersString) {
  return monstersString.split(';').map(monster => {
      const details = monster.split(',').map(detail => detail.trim());
      return {
          Name: details[0],
          Sex: details[1],
          Race: details[2],
          Class: details[3],
          Level: parseInt(details[4], 10),
          AC: parseInt(details[5], 10),
          XP: parseInt(details[6], 10),
          HP: parseInt(details[7], 10),
          MaxHP: parseInt(details[8], 10)
      };
  });
}

let equippedInventory = [];


// Function to update the game console based on user inputs and get the updated game console
function updateGameConsole(userInput, currentCoordinates, conversationHistory, itemToTake, serverGameConsole) {

// Initialize the coordinates
let { x, y, z } = currentCoordinates;
let objectsInRoomString = [];
let itemsInRoom = [];

  // Get the most recent visited room's coordinates from the Set
const recentCoordinates = Array.from(visitedRooms).pop();
const coordinatesString = coordinatesToString(currentCoordinates);

console.log('currentCoordinates:', currentCoordinates);
console.log("Connected Rooms:", roomConnections);

// Parse user input to check for valid directions
const validDirections = ["north", "n", "south", "s", "east", "e", "west", "w", "northeast", "ne", "northwest", "nw", "southeast", "se", "southwest", "sw", "up", "u", "down", "d"];

let userWords = userInput.split(/\s+/).map(word => word.toLowerCase());

// Check if the updated coordinates are already present in the conversation history
const matchingConsole = findMatchingConsoleByCoordinates(conversationHistory, currentCoordinates);
let roomName = "";
let roomHistory = ""; // Initialize roomHistory
//  const roomKey = coordinatesToString(currentCoordinates);
let roomEquipment = [];
let objectMetadata = [];
let characterString = [];
const roomKey = coordinatesToString(currentCoordinates);
    
  let monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];

// Format the list of monsters in the current room as a string
let monstersInRoomString = monstersInRoom.length > 0
  ? monstersInRoom.map(monster => {
    return `${monster.Name}
    ${monster.Sex}
    ${monster.Race}
    ${monster.Class}
    Level: ${monster.Level}
    AC: ${monster.AC}
    XP: ${monster.XP}
    HP: ${monster.HP}
    MaxHP: ${monster.MaxHP}`;
  }).join("\n")
  : "None";

console.log("Monsters in Room:", monstersInRoomString);

console.log("monstersInRoom:", monstersInRoom);

//  let roomKey = coordinatesToString(currentCoordinates);

  // First, process any monsters data from serverGameConsole
//    generateMonstersForRoom(roomKey, serverGameConsole);


// Define visitedRoomCoordinates as a Set with visited coordinates
let visitedRoomCoordinates = new Set(Array.from(visitedRooms).map(coordinatesToString));
console.log("currentCoordinates:", currentCoordinates);
console.log("visitedRoomCoordinates:", visitedRoomCoordinates);

// Check if serverGameConsole is defined and has the expected content
if (serverGameConsole) {
  let roomNameMatch = serverGameConsole.match(/Room Name: (.+)/);
  if (roomNameMatch) roomName = roomNameMatch[1];

  let roomHistoryMatch = serverGameConsole.match(/Room Description: (.+)/);
  if (roomHistoryMatch) roomHistory = roomHistoryMatch[1];
  
generateMonstersForRoom(roomKey, serverGameConsole);
monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];

// Format the list of monsters in the current room as a string
monstersInRoomString = monstersInRoom.length > 0
  ? monstersInRoom.map(monster => {
    return `${monster.Name}
    ${monster.Sex}
    ${monster.Race}
    ${monster.Class}
    Level: ${monster.Level}
    AC: ${monster.AC}
    XP: ${monster.XP}
    HP: ${monster.HP}
    MaxHP: ${monster.MaxHP}`;
  }).join("\n")
  : "None";

console.log("Monsters in Room:", monstersInRoomString);

//   let roomMonstersMatch = serverGameConsole.match(/Monsters in Room: ([\s\S]+)/);
//      if (roomMonstersMatch) {
//                    let monstersData = roomMonstersMatch[1];

      // Generate or update monsters for the room from server game console data
   //   generateMonstersForRoom(roomKey, serverGameConsole);
   //   monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];
      // Parse monstersData to create monster objects and store them in monstersInVisitedRooms
      // This assumes you have a function to parse the detailed string into monster objects
  //    let parsedMonsters = parseMonstersData(monstersData);
  //    monstersInVisitedRooms.set(roomKey, parsedMonsters);
      
  //    monstersInRoomString = monstersData;  // Store the raw string if needed elsewhere
   //   }
      
//    monstersInVisitedRooms.set(roomKey, monstersInRoom[1]);
//   generateMonstersForRoom(roomKey);
//    monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];
//    console.log(monstersInVisitedRooms.get(roomKey));
//    console.log(monstersInRoom);

  }

  // Use monstersInRoom to set or update monsters in the visited rooms map



// if (serverGameConsole) {
//     monstersInRoomString = serverGameConsole.match(/Monsters in Room: (.+)/)?.[1];
// }
    
    
    

// Get the exits for the current room
let exits = [];
if (currentCoordinates.x === 0 && currentCoordinates.y === 0 && currentCoordinates.z === 0 && !matchingConsole) {
  roomName = "Ruined Temple"
  roomHistory = "You find yourself standing in the first room of the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels and powerful demons..."; // Set preset value for specific coordinates
  exits = generateUniqueExits(currentCoordinates, conversationHistory);
  // Check if there's a chance to add equipment to the room
// Check if there's a chance to add equipment to the room

// Inside the code where new items are randomly generated, add XP to PC and NPCs
if (Math.random() < 1.0) {
const randomEquipment = equipmentItems[Math.floor(Math.random() * equipmentItems.length)];

if (!roomEquipment.some(existingObject => areItemsEqual(existingObject, randomEquipment))) {
  roomEquipment.push(randomEquipment);

  // Add XP to PC
  characters.forEach(char => {
      char.XP += experienceToAdd; // Add XP to PC

  });

  // Add XP to NPCs
  npcs.forEach(npc => {
    npc.XP += experienceToAdd; // Add XP to NPCs
  });
}
}
  // Update the visited rooms set with the current room's coordinates
  visitedRooms.add(currentCoordinates);
  // Print the visited rooms to the console
  console.log('Visited Rooms:', Array.from(visitedRooms));
  console.log('Room History:', roomConversationHistories);
} else if (currentCoordinates.x === 0 && currentCoordinates.y === 0 && currentCoordinates.z === 0 && matchingConsole) {
  const lines = conversationHistory.split("\n");
  const coordinatesIndex = lines.indexOf(matchingConsole);
  if (coordinatesIndex !== -1 && lines.length >= coordinatesIndex + 4) {
    exits = lines[coordinatesIndex + 3].replace("Exits: ", "").split(", ");
        // Extract equipment from the conversation history
    roomEquipment = roomConversationHistories[coordinatesString][roomConversationHistories[coordinatesString].length - 1].roomEquipment;
  // Check if the item to take is in the inventory
//  if (inventory.includes(itemToTake)) {
    // Remove the item from "Objects in Room"
//     roomEquipment = roomEquipment.filter(obj => obj !== itemToTake);
//   }
    roomName = "Ruined Temple"
    roomHistory = "You find yourself standing in the first room of the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels and powerful demons..."; // Set preset value for specific coordinates
  }
  // Update the visited rooms set with the current room's coordinates
  visitedRooms.add(currentCoordinates);
  console.log('Visited Rooms:', Array.from(visitedRooms));
  console.log('Room History:', roomConversationHistories);
} else if (!matchingConsole) {
  exits = generateUniqueExits(currentCoordinates, conversationHistory);
  // Check if there's a chance to add equipment to the room
// Check if there's a chance to add equipment to the room

// Inside the code where new items are randomly generated, add XP to PC and NPCs
if (Math.random() < 1.0) {
const randomEquipment = equipmentItems[Math.floor(Math.random() * equipmentItems.length)];

if (!roomEquipment.some(existingObject => areItemsEqual(existingObject, randomEquipment))) {
  roomEquipment.push(randomEquipment);

  // Add XP to PC
  characters.forEach(char => {
 
      char.XP += experienceToAdd; // Add XP to PC
   
  });

  // Add XP to NPCs
  npcs.forEach(npc => {
    npc.XP += experienceToAdd; // Add XP to NPCs
  });
}
}
  // Update the visited rooms set with the current room's coordinates
  visitedRooms.add(currentCoordinates);
  // Print the visited rooms to the console
  console.log('Visited Rooms:', Array.from(visitedRooms));
  console.log('Room History:', roomConversationHistories);
} else {
const lines = conversationHistory.split("\n");
const coordinatesIndex = lines.indexOf(matchingConsole);
if (coordinatesIndex !== -1 && lines.length >= coordinatesIndex + 4) {
  exits = lines[coordinatesIndex + 3].replace("Exits: ", "").split(", ");
  // Extract equipment from the conversation history
updateRoomConversationFirstResponse(currentCoordinates, serverGameConsole);
const roomHistoryObj = getFirstResponseForRoom(currentCoordinates); // Get the room's first response based on coordinates
if (roomHistoryObj) {
  // Ensure that roomName and roomHistory are updated based on the first response in the room's conversation history
  roomName = roomHistoryObj.roomName; // Provide a default if undefined
  roomHistory = roomHistoryObj.roomHistory; 
//   monstersInRoomString = roomHistoryObj.monstersInRoom[1];// Provide a default if undefined
  console.log("Room History Object:", roomHistoryObj);
console.log("Full object inspection:", JSON.stringify(roomHistoryObj, null, 2));
}
  if (
roomConversationHistories[coordinatesString] &&
roomConversationHistories[coordinatesString].length > 0
) {
// Get the last item in the room's conversation history
const lastRoomHistory =
  roomConversationHistories[coordinatesString][
    roomConversationHistories[coordinatesString].length - 1
  ];

                  // Get second last history entry (where objectMetadata is expected)
                  const secondLastRoomHistory =
                      roomConversationHistories[coordinatesString][
                          roomConversationHistories[coordinatesString].length - 2
                      ];

                  // Update roomEquipment
                  if (lastRoomHistory.roomEquipment) {
                      roomEquipment = lastRoomHistory.roomEquipment;
                  }

                  // Update objectMetadata
                  if (secondLastRoomHistory.objectMetadata) {
                      objectMetadata = secondLastRoomHistory.objectMetadata;
                  } 
}

  // Check if the item to take is in the inventory
//    if (inventory.includes(itemToTake)) {
    // Remove the item from "Objects in Room"
//      roomEquipment = roomEquipment.filter(obj => obj !== itemToTake);
//    }
  
  visitedRooms.add(currentCoordinates);
  console.log('recentCoordinates:', recentCoordinates); // Log recentCoordinates every turn
  // Print the visited rooms to the console
  console.log('Visited Rooms:', Array.from(visitedRooms));
  console.log('Room History:', roomConversationHistories);
} else {
    exits = [];
  }
}

// Check if there are additional objects in the room's conversation history
if (roomConversationHistories[coordinatesString] && roomConversationHistories[coordinatesString].length > 0) {
// Get the first response from the room's conversation history
const firstResponse = roomConversationHistories[coordinatesString][0].response;

// Create a regular expression pattern to match any equipment item from the list
const equipmentPattern = new RegExp(`\\b(${equipmentItems.map(item => escapeRegExp(item)).join('|')})\\b`, 'gi');

// Find all equipment items mentioned in the first response
//  const mentionedEquipment = Array.from(new Set(firstResponse.match(equipmentPattern) || []));

// Filter out equipment that is already in the room's equipment or have a similar name
//  const newAdditionalEquipment = mentionedEquipment
//   .map(item => item.trim()) // Remove leading and trailing whitespace
//   .filter(item => !roomEquipment.some(existingItem => areItemsEqual(existingItem, item)));

// Create a new array to store the combined equipment
//const combinedEquipment = roomEquipment.concat(newAdditionalEquipment);

// Update roomEquipment with the combined equipment
//roomEquipment = combinedEquipment;
}

// Check if the last user input was "search room" based on userWords
const isSearchRoom = userWords.length >= 2 && userWords.slice(-2).join(" ").toLowerCase() === "search room";
console.log('userWords:', userWords);
console.log('isSearchRoom:', isSearchRoom);

if (isSearchRoom && roomConversationHistories[coordinatesToString(currentCoordinates)] && roomConversationHistories[coordinatesToString(currentCoordinates)].length > 0) {
// Get the most recent response from the room's conversation history
const mostRecentResponse = roomConversationHistories[coordinatesToString(currentCoordinates)][roomConversationHistories[coordinatesToString(currentCoordinates)].length - 1].response;

// Create a regular expression pattern to match any equipment item from the list
const equipmentPattern = new RegExp(`\\b(${equipmentItems.map(item => escapeRegExp(item)).join('|')})\\b`, 'gi');

// Find all equipment items mentioned in the most recent response
const mentionedEquipment = Array.from(new Set(mostRecentResponse.match(equipmentPattern) || []));
  
// Filter out equipment that is already in the room's equipment, have a similar name, or is in the player's inventory
const newAdditionalEquipment = mentionedEquipment
.map(item => item.trim().toLowerCase()) // Convert to lowercase and remove leading/trailing whitespace
.filter(item => {
  // Check if the item is not a substring of any existing equipment except the most recent room response
  return  !roomEquipment.slice(0, -1).some(existingItem => existingItem.toLowerCase().includes(item)) && !inventory.some(existingItem => existingItem.toLowerCase().includes(item)) || 
      !roomEquipment.includes(item) ||
      !roomEquipment.some(existingItem => existingItem.toLowerCase().includes(item)); // Check if the item is not similar to any existing equipment
});


// Check if roomEquipment is empty
if (roomEquipment.length < 1) {
// If it's empty, set roomEquipment to newAdditionalEquipment
roomEquipment = newAdditionalEquipment;
} else {
// If it's not empty, combine roomEquipment and newAdditionalEquipment
roomEquipment = roomEquipment.concat(newAdditionalEquipment);
}

let combinedEquipment = [...new Set(roomEquipment.concat(newAdditionalEquipment))];
objectsInRoomString = combinedEquipment;
if (objectsInRoomString.length > 0) {
// Remove "None" or "None " if they exist in the array
objectsInRoomString = objectsInRoomString.filter(item => item !== "None" && item !== "None ");
}
itemsInRoom = objectsInRoomString;
roomEquipment = objectsInRoomString;

console.log('objectsInRoomString:', objectsInRoomString);
console.log('itemsInRoom:', itemsInRoom);

// Use the getFirstResponseForRoom function to get the first response
const firstResponseForRoom = getFirstResponseForRoom(currentCoordinates);

if (firstResponseForRoom) {
  // Add sentences to the first response about the newly found equipment
  const addedSentences = newAdditionalEquipment.map(item => `There is ${item} here.`);
  firstResponseForRoom.response = `${firstResponseForRoom.response} ${addedSentences.join(' ')}`;
}
}

// Create the character based on the player's choice
let character = null;


// Construct a string to represent all characters in the characters array
let charactersString = characters.map((char, index) => {
//  let equippedItems = char.Equipped.join(', '); // Get the equipped items
//  if (equippedItems.length < 1) {
//    equippedItems = "None"; // Add "Equipped" prefix
//  }
  return `${char.Name}
    ${char.Sex}
    ${char.Race}
    ${char.Class}
    Level: ${char.Level}
    AC: ${char.AC}
    XP: ${char.XP}
    HP: ${char.HP}
    MaxHP: ${char.MaxHP}`;
//      Equipped: ${equippedItems}`;
}).join("\n");

if (userInput === '1' && charactersString.length <= 0) {
userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
userWords = "";
character = createMortaciaCharacter();
} else if (userInput === '2' && charactersString.length <= 0) {
userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
userWords = "";
character = createSuzerainCharacter();
} else if (userInput === '3' && charactersString.length <= 0) {
  userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
userWords = "";
  character = createCharacter();
}

// Create a string representing NPCs and Mortacia
let npcsString = npcs.length > 0
? npcs.map((char, index) => {
  return `${char.Name}
      ${char.Sex}
      ${char.Race}
      ${char.Class}
      Level: ${char.Level}
      AC: ${char.AC}
      XP: ${char.XP}
      HP: ${char.HP}
      MaxHP: ${char.MaxHP}`;
}).join('\n')
: "None";

// Update HP and level based on XP for both PC and NPCs
characters.forEach(char => {
// Calculate the new level based on XP
const newLevel = Math.floor(char.XP / 15000) + 1;

// Check if the level has increased
if (newLevel > char.Level) {
  char.Level = newLevel;
      // Calculate AC starting at 10 and increasing by 1 for every ten levels
  char.AC = 10 + Math.floor(char.Level / 10);

  // Define character classes and their respective HP generation
  const characterClasses = [
    { name: 'Knight of Atinus', baseHP: 10 },
    { name: 'Knight of Atricles', baseHP: 11},
    { name: 'Wizard', baseHP: 6 },
    { name: 'Witch', baseHP: 6 }, 
    { name: 'Necromancer', baseHP: 6 }, 
    { name: 'Warlock', baseHP: 6 }, 
    { name: 'Sorcerer', baseHP: 6 }, 
    { name: 'Thief', baseHP: 8 }, 
    { name: 'Assassin', baseHP: 8 }, 
    { name: 'Barbarian', baseHP: 11 },
    { name: 'Assassin-Fighter-Necromancer-Goddess', baseHP: 11 }, 
    // Add other classes here
  ];
  
  // Find the character's class
  const characterClass = characterClasses.find(cls => cls.name === char.Class);

  // Calculate HP increase based on the class's HP generation
  let hpIncrease = 0;
  if (characterClass && characterClass.name === 'Knight of Atinus') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 10); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Knight of Atricles') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 11); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Wizard') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Witch') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Necromancer') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Warlock') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Sorcerer') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Thief') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 8); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Assassin') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 8); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Barbarian') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 11); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Assassin-Fighter-Necromancer-Goddess') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 11); // Increase by 1d10 for each level
  } else {
    // For generic or unknown classes, use a default 1d10 HP increase per level
    hpIncrease = rollDice(newLevel, 10); // Increase by 1d10 for each level
  }
  

  // Calculate new HP and MaxHP
  char.HP += hpIncrease;
  char.MaxHP += hpIncrease;
}
});

// Update HP and level for NPCs
npcs.forEach(npc => {
// Calculate the new level based on XP
const newLevel = Math.floor(npc.XP / 15000) + 1;

// Check if the level has increased
if (newLevel > npc.Level) {
  npc.Level = newLevel;
  
      // Calculate AC for NPCs
  npc.AC = 10 + Math.floor(npc.Level / 10);

  // Define character classes and their respective HP generation
  const characterClasses = [
    { name: 'Knight of Atinus', baseHP: 10 },
    { name: 'Knight of Atricles', baseHP: 11},
    { name: 'Wizard', baseHP: 6 },
    { name: 'Witch', baseHP: 6 }, 
    { name: 'Necromancer', baseHP: 6 }, 
    { name: 'Warlock', baseHP: 6 }, 
    { name: 'Sorcerer', baseHP: 6 }, 
    { name: 'Thief', baseHP: 8 }, 
    { name: 'Assassin', baseHP: 8 }, 
    { name: 'Barbarian', baseHP: 11 },
    { name: 'Assassin-Fighter-Necromancer-Goddess', baseHP: 11 }, 
    // Add other classes here
  ];

  // Find the NPC's class
  const characterClass = characterClasses.find(cls => cls.name === npc.Class);

  // Calculate HP increase based on the class's HP generation
  let hpIncrease = 0;
  if (characterClass && characterClass.name === 'Knight of Atinus') {
    // Calculate additional HP based on the NPC's current level
    hpIncrease = rollDice(newLevel, 10); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Knight of Atricles') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 11); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Wizard') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Witch') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Necromancer') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Warlock') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Sorcerer') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Thief') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 8); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Assassin') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 8); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Barbarian') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 11); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Assassin-Fighter-Necromancer-Goddess') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 10); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Warrior') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 11); // Increase by 1d10 for each level
  } else if (characterClass && characterClass.name === 'Shaman') {
    // Calculate additional HP based on the character's current level
    hpIncrease = rollDice(newLevel, 6); // Increase by 1d10 for each level
  } else {
    // For generic or unknown classes, use a default 1d10 HP increase per level
    hpIncrease = rollDice(newLevel, 10); // Increase by 1d10 for each level
  }

  // Calculate new HP and MaxHP
  npc.HP += hpIncrease;
  npc.MaxHP += hpIncrease;
}
});




// Your modified code for adding monsters to NPCs
const addMonsterToPartyPattern = /^add\s+([a-zA-Z\s]+)\s+to\s+party$/i;

if (addMonsterToPartyPattern.test(userInput)) {
const match = userInput.match(addMonsterToPartyPattern);
const monsterName = match[1].trim(); // Extract the monster name

// Find the index of the monster in monstersInRoom
const monsterIndex = monstersInRoom.findIndex(
  (monster) => monster.Name.toLowerCase() === monsterName.toLowerCase()
);

if (monsterIndex !== -1) {
  // Get the monster details
  const monsterDetails = monstersInRoom[monsterIndex];

  // Remove the monster from monstersInRoom
  monstersInRoom.splice(monsterIndex, 1);

  // Add the removed monster to npcs
  npcs.push(monsterDetails);

  // Format the list of monsters in the current room as a string
  const monstersInRoomStringUpdated = monstersInRoom
    .map((monster) => {
      return `${monster.Name}
        ${monster.Sex}
        ${monster.Race}
        ${monster.Class}
        Level: ${monster.Level}
        AC: ${monster.AC}
        XP: ${monster.XP}
        HP: ${monster.HP}
        MaxHP: ${monster.MaxHP}`;
    })
    .join("\n");

  // Format the list of NPCs as a string
  const npcsStringUpdated = npcs
    .map((char, index) => {
      return `${char.Name}
        ${char.Sex}
        ${char.Race}
        ${char.Class}
        Level: ${char.Level}
        AC: ${char.AC}
        XP: ${char.XP}
        HP: ${char.HP}
        MaxHP: ${char.MaxHP}`;
    })
    .join("\n");

  // Append the result to the conversation history
  conversationHistory += `\nYou added ${monsterName} to the party.\n`;
  conversationHistory += `\nMonsters in the room:\n${monstersInRoomStringUpdated}\n`;
  conversationHistory += `\nNPCs in the party:\n${npcsStringUpdated}\n`;
} else {
  // Handle the case where the specified monster was not found in the room
  conversationHistory += `\n${monsterName} is not in the room.\n`;
}
}

// Your code for removing a character from NPCs and putting it back in Monsters
const removeMonsterFromPartyPattern = /^remove\s+([a-zA-Z\s]+)\s+from\s+party$/i;

if (removeMonsterFromPartyPattern.test(userInput)) {
const match = userInput.match(removeMonsterFromPartyPattern);
const characterName = match[1].trim(); // Extract the character name

// Find the index of the character in npcs
const characterIndex = npcs.findIndex(
  (character) => character.Name.toLowerCase() === characterName.toLowerCase()
);

if (characterIndex !== -1) {
  // Get the character details
  const characterDetails = npcs[characterIndex];

  // Remove the character from npcs
  npcs.splice(characterIndex, 1);

  // Add the removed character back to monstersInRoom
  monstersInRoom.push(characterDetails);

  // Format the list of NPCs as a string
  const npcsStringUpdated = npcs
    .map((char, index) => {
      return `${char.Name}
        ${char.Sex}
        ${char.Race}
        ${char.Class}
        Level: ${char.Level}
        AC: ${char.AC}
        XP: ${char.XP}
        HP: ${char.HP}
        MaxHP: ${char.MaxHP}`;
    })
    .join("\n");

  // Update npcsString with the new data
  npcsString = npcsStringUpdated;

  // Format the list of monsters in the current room as a string
  const monstersInRoomStringUpdated = monstersInRoom
    .map((monster) => {
      return `${monster.Name}
        ${monster.Sex}
        ${monster.Race}
        ${monster.Class}
        Level: ${monster.Level}
        AC: ${monster.AC}
        XP: ${monster.XP}
        HP: ${monster.HP}
        MaxHP: ${monster.MaxHP}`;
    })
    .join("\n");

  // Append the result to the conversation history
  conversationHistory += `\nYou removed ${characterName} from the party.\n`;
  conversationHistory += `\nMonsters in the room:\n${monstersInRoomStringUpdated}\n`;
  conversationHistory += `\nNPCs in the party:\n${npcsString}\n`;

  // Now, call the displayAllNPCData function to update the displayed data for all NPC slots
  for (let i = 0; i < 6; i++) {
    displayAllNPCData(npcsString, i);
  }
} else {
  // Handle the case where the specified character was not found in the party
  conversationHistory += `\n${characterName} is not in the party.\n`;
}
}

// Format the inventory as a string
const inventoryString = inventory.length > 0 ? inventory.join(", ") : "Empty";
// Format the exits as a string
const exitsString = exits.join(", ");
// Format the equipment items as a string
const equipmentString = roomEquipment.length > 0 ? roomEquipment.map(item => item.trim()).join(", ") : "None";
  // Use the object metadata directly as a plain text string
const metadataString = objectMetadata.length > 0 ? objectMetadata : "None";
// Calculate the number of visited rooms
const numVisitedRooms = calculateNumVisitedRooms();
// Calculate the connected rooms
const connectedRooms = calculateConnectedRooms(currentCoordinates);

// Format the list of connected rooms as a string
const connectedRoomsString = connectedRooms.join("; ");

// Display PC and NPC data

displayAllNPCData(npcsString, 0);
displayAllNPCData(npcsString, 1);
displayAllNPCData(npcsString, 2);
displayAllNPCData(npcsString, 3);
displayAllNPCData(npcsString, 4);
displayAllNPCData(npcsString, 5);
displayPCData(charactersString);

// Return the updated game console as a formatted string
return `
Seed: 
Room Name: ${roomName}
Room Description: ${roomHistory}
Coordinates: X: ${x}, Y: ${y}, Z: ${z}
Objects in Room: ${equipmentString}
Objects in Room Properties: ${metadataString}
Exits: ${exitsString}
Score: 
Artifacts Found: 
Quests Achieved: 
Inventory: ${inventoryString}
Equipped Items: ${equippedInventory.join(", ")}
Turns: ${turns}
PC: ${charactersString}
NPCs in Party: ${npcsString}
Monsters in Room: ${monstersInRoomString}
Rooms Visited: ${numVisitedRooms}
Coordinates of Connected Rooms: ${connectedRoomsString}
`; // Add characters to the game console
return; 
}

// Function to display PC data in the PC column
function displayPCData(charactersString) {
const pcColumn = document.querySelector('.character-column:nth-child(1)');

// Clear the PC column first
pcColumn.innerHTML = '';

// Add the PC data
pcColumn.innerHTML += `
  <b>PC:</b><br>
  ${charactersString.replace(/\n/g, '<br>')} <!-- Replace newlines with <br> tags -->
`;
}

// Modify displayAllNPCData to append HTML instead of overwriting
function displayAllNPCData(npcsString, npcNumber, removedCharacterName, npcsStringUpdated) {
// Check if npcsStringUpdated is available and use it as the first option
if (npcsStringUpdated) {
  npcsString = npcsStringUpdated;
}

// Split the NPCs' data by lines
let npcDataLines = npcsString.split('\n');

// Calculate the number of lines per NPC dynamically (assuming each NPC has 8 lines)
const linesPerNPC = 9;

// Find the corresponding <td> element by index
const npcDataElement = document.querySelectorAll('.character-column')[npcNumber + 1]; // +1 to account for the PC column

// Clear the HTML content of the NPC slot
npcDataElement.innerHTML = '';

// Calculate the start and end indices for the desired NPC
const startIndex = npcNumber * linesPerNPC; // Adjusted to start from 0
const endIndex = startIndex + linesPerNPC;

if (startIndex >= 0 && endIndex <= npcDataLines.length) {
  // Create an HTML string for the specified NPC
  const npcHTML = `
    <div class="npc-data">
    <b>NPCs:</b><br>
      ${npcDataLines.slice(startIndex, endIndex).join('<br>')}
    </div>
  `;

  // Append the generated HTML string to the <td> element's innerHTML
  npcDataElement.innerHTML += npcHTML;
} else {
  // Display a message if the specified NPC number is out of range
  console.log('NPC not found.');
}
}


function calculateNumVisitedRooms() {
return visitedRooms.size;
}

function calculateConnectedRooms(currentCoordinates) {
// Check if the roomConnections entry exists for the current room
const roomConnection = roomConnections[coordinatesToString(currentCoordinates)];
if (!roomConnection) {
  return [];
}

// Get the connected rooms for the current room and extract their coordinates
const connectedRooms = roomConnection.connectedRooms.map(coordObj => coordinatesToString(coordObj));

return connectedRooms;
}


function getAdjacentCoordinates(coordinates) {
const adjacentCoordinates = new Set();
const validOffsets = [
  { x: 0, y: 1, z: 0 }, // north
  { x: 0, y: -1, z: 0 },  // south
  { x: 1, y: 0, z: 0 },  // east
  { x: -1, y: 0, z: 0 }, // west
  { x: 1, y: 1, z: 0 },  // northeast
  { x: -1, y: 1, z: 0 }, // northwest
  { x: 1, y: -1, z: 0 }, // southeast
  { x: -1, y: -1, z: 0 },// southwest
  { x: 0, y: 0, z: 1 },  // up
  { x: 0, y: 0, z: -1 }, // down
];

for (const offset of validOffsets) {
  const adjacentCoord = {
    x: coordinates.x + offset.x,
    y: coordinates.y + offset.y,
    z: coordinates.z + offset.z,
  };
  adjacentCoordinates.add(coordinatesToString(adjacentCoord)); // Convert to string for comparison
}

return adjacentCoordinates;
}


// Function to convert coordinates object to a string
function coordinatesToString(coordinates) {
return `${coordinates.x},${coordinates.y},${coordinates.z}`;
}

// Function to check if two objects are equal
function areObjectsEqual(obj1, obj2) {
const keys1 = Object.keys(obj1);
const keys2 = Object.keys(obj2);

if (keys1.length !== keys2.length) {
  return false;
}

for (const key of keys1) {
  if (obj1[key] !== obj2[key]) {
    return false;
  }
}

return true;
}


// Function to perform dynamic search using TF-IDF
async function performDynamicSearch(query, maxWordCount = 700) {
// Retrieve the conversation history from IndexedDB
const conversationId = localStorage.getItem("conversationId");
const promptAndResponses = await getPromptsAndResponsesForConversation(conversationId);

// Get the last 8 prompts and responses from the end of the array
const last8PromptAndResponses = promptAndResponses.slice(-8);

// Extract the prompts and responses
const prompts = last8PromptAndResponses.map(item => item.prompt);
const responses = last8PromptAndResponses.map(item => item.response);
console.log("Last 8 responses:", last8PromptAndResponses);

// Keywords to exclude
const excludeKeywords = [
  "Seed:", "Room Description:", "Coordinates:", "Objects in Room:", 
  "Exits:", "XP:", "Score:", "Artifacts Found:", 
  "Quests Achieved:", "HP:", "Inventory:", "PC:", 
  "NPCs:", "Rooms Visited:", "Turns:", "north", "south", "east", "west", "northeast", "southeast", "northwest", "southwest", "up", "down"
];

// Function to check if a line includes any of the exclude keywords
const shouldExcludeLine = (line) => line && excludeKeywords.some(keyword => line.toLowerCase().trim().includes(keyword.toLowerCase()));

// Filter out lines that include exclude keywords
const filteredResponses = last8PromptAndResponses.filter(promptAndResponse => {
const excluded = shouldExcludeLine(promptAndResponse.response); // Access response as promptAndResponse.response.response
console.log(`Response ${promptAndResponse.response.response} excluded? ${excluded}`);
return !excluded;
});
// Preprocess the query and filtered responses (lowercase and remove punctuation)
const preprocessText = (text) => text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");

// Tokenize the query and responses into words (unigrams)
const wordsInQuery = preprocessText(query).split(/\s+/);
const wordsInResponses = promptAndResponses.map(promptAndResponse =>
  preprocessText(promptAndResponse.response).split(/\s+/)
);

// Calculate the TF-IDF scores for each word in the query and responses
const wordTFIDFScores = {};
const queryWordCounts = {};
wordsInQuery.forEach(word => {
  queryWordCounts[word] = (queryWordCounts[word] || 0) + 1;
});

// Calculate Term Frequency (TF) for the query
const queryWordTFIDFScores = {};
Object.keys(queryWordCounts).forEach(word => {
  const termFrequency = queryWordCounts[word] / wordsInQuery.length;
  const inverseDocumentFrequency = Math.log(promptAndResponses.length / wordsInResponses.filter(words => words.includes(word)).length);
  queryWordTFIDFScores[word] = termFrequency * inverseDocumentFrequency;
});

// Calculate TF-IDF scores for words in the responses
wordsInResponses.forEach((responseWords, responseIndex) => {
  responseWords.forEach(word => {
    if (!wordTFIDFScores[word]) {
      const termFrequency = responseWords.filter(w => w === word).length / responseWords.length;
      const inverseDocumentFrequency = Math.log(promptAndResponses.length / wordsInResponses.filter(words => words.includes(word)).length);
      wordTFIDFScores[word] = termFrequency * inverseDocumentFrequency;
    }
  });
});

// Calculate the relevance score for each response and prompt
const responsePromptRelevanceScores = last8PromptAndResponses.map(({ prompt, response, index }) => {
const responseWords = preprocessText(response).split(/\s+/);
const promptWords = preprocessText(prompt).split(/\s+/);

let relevanceScore = 0;

responseWords.forEach(word => {
  if (queryWordTFIDFScores[word]) {
    relevanceScore += queryWordTFIDFScores[word] * wordTFIDFScores[word];
  }
});

promptWords.forEach(word => {
  if (queryWordTFIDFScores[word]) {
    relevanceScore += queryWordTFIDFScores[word] * wordTFIDFScores[word];
  }
});

return { prompt, response, relevanceScore, index };
});

// Sort the responses and prompts in chronological order first and then by relevance score
responsePromptRelevanceScores.sort((a, b) => {
if (a.index === b.index) {
  // If responses/prompts have the same index, sort by relevance score
  return b.relevanceScore - a.relevanceScore;
}
// Otherwise, sort by index (chronological order)
return a.index - b.index;
});

// Sort the responses by original index (chronological order)
filteredResponses.sort((a, b) => a.index - b.index);

// Calculate the total word count of selected sentences
let currentWordCount = 0;
const selectedResponsesPrompts = [];

for (const { prompt, response } of responsePromptRelevanceScores) {
const promptWords = prompt.split(/\s+/);
const responseWords = response.split(/\s+/);

if (currentWordCount + promptWords.length + responseWords.length <= maxWordCount) {
  selectedResponsesPrompts.push({ prompt, response });
  currentWordCount += promptWords.length + responseWords.length;
} else {
  break;
}
}

console.log("filteredResponses:", filteredResponses); // Debug: Print filtered responses

// ... (rest of the code)

console.log("responseRelevanceScores:", responsePromptRelevanceScores); // Debug: Print relevance scores

// ... (rest of the code)

console.log("selectedResponses:", selectedResponsesPrompts); // Debug: Print selected responses


// Join the selected responses and prompts into a single string
const selectedResults = last8PromptAndResponses.map(({ prompt, response }) => `${prompt}\n${response}`).join("\n\n");

return selectedResults;

}

var previousResponse = [];

function scrollToBottom() {
window.scrollTo(0, document.body.scrollHeight);
}

/*// Function to translate shorthand commands into full commands
function translateShorthandCommands(userInput) {
const shorthandMap = {
  'n': 'north',
  's': 'south',
  'e': 'east',
  'w': 'west',
  'nw': 'northwest',
  'sw': 'southwest',
  'ne': 'northeast',
  'se': 'southeast',
  'u': 'up',
  'd': 'down',
  'l': 'look',
  //'i': 'inventory'
  // Add more shorthand translations as needed
};

const words = userInput.toLowerCase().split(/\s+/);
const translatedWords = words.map(word => shorthandMap[word] || word);
return translatedWords.join(' ');
}*/

// Define an array to store character information
const characters = [];

let character = {
  Name: '',
  Sex: '',
  Race: '',
  Class: '',
  Level: 1,
  AC: 10,
  XP: 0,
  HP: 0,
  MaxHP: 0,
};

console.log('characters:', characters);

// Define character classes and their respective stats
const characterClasses = [
{ name: 'Knight of Atinus', hp: '10 + 1d10', description: 'God of War' },
{ name: 'Knight of Atricles', hp: '10 + 1d11', description: 'God of Justice' },
{ name: 'Wizard', hp: '10 + 1d6', description: 'a student of magic and the arcane arts.' },
{ name: 'Witch', hp: '10 + 1d6', description: 'Worships Mortacia, goddess of death' },
{ name: 'Necromancer', hp: '10 + 1d6', description: 'Worships Mortacia, goddess of death' },
{ name: 'Warlock', hp: '10 + 1d6', description: 'Powers come from within through possession and use of dark magic' },
{ name: 'Sorcerer', hp: '10 + 1d6', description: 'Powers come from within through possession and use of light magic' },
{ name: 'Thief', hp: '10 + 1d8', description: '' },
{ name: 'Assassin', hp: '10 + 1d8', description: '' },
{ name: 'Barbarian', hp: '10 + 1d11', description: '' },
];

const characterRaces = [
  { name: 'Human', description: '.' },
  { name: 'Dwarf', description: 'who mine the mountains.'},
  { name: 'High Elf', description: 'of light magic.' },
  { name: 'Unseelie Elf', description: 'of dark magic.' },
  { name: 'Half-Elf', description: '.' },
  { name: 'Halfling', description: '.' },
  { name: 'Fey', description: 'pixie-like creatures related to the elves.'},
  { name: 'Raakshasa', description: 'cat-like beings who tend to be dark sorcerers and necromancers.' },
  { name: 'Gnome', description: 'humanoids who thrive at the arts of invention.' },
];

// Define monster races
const monsterRaces = [
{ name: 'Orc', description: 'Savage and brutal' },
{ name: 'Goblin', description: 'Small and cunning' },
{ name: 'Dragonborn', description: 'Dragon-like humanoids' },
{ name: 'Aboleth', description: 'Mind-controlling horrors' },
{ name: 'Aboleth Mage', description: 'Powerful aboleth spellcasters' },
{ name: 'Achaierai', description: 'Four-legged, beak-faced fiends' },
{ name: 'Allip', description: 'Tormented, babbling undead' },
{ name: 'Angel', description: 'Celestial beings of light' },
{ name: 'Angel, Astral Deva', description: 'Noble astral angels' },
{ name: 'Angel, Planetar', description: 'Mighty planetar angels' },
{ name: 'Angel, Solar', description: 'Radiant solar angels' },
{ name: 'Animated Object', description: 'Inanimate objects brought to life' },
{ name: 'Ankheg', description: 'Giant insectoid burrowers' },
{ name: 'Aranea', description: 'Shape-shifting spider folk' },
{ name: 'Archon', description: 'Celestial servants of law' },
{ name: 'Lantern Archon', description: 'Small celestial beings of light' },
{ name: 'Hound Archon', description: 'Celestial dog-like guardians' },
{ name: 'Hound Archon Hero', description: 'Mighty hero among hound archons' },
{ name: 'Trumpet Archon', description: 'Celestial horn-blowing warriors' },
{ name: 'Arrowhawk', description: 'Airborne elemental creatures' },
{ name: 'Assassin Vine', description: 'Lurking, deadly plant creatures' },
{ name: 'Athach', description: 'Three-armed, one-eyed brutes' },
{ name: 'Avoral', description: 'Eagle-headed celestial beings' },
{ name: 'Azer', description: 'Fire-loving dwarf-like creatures' },
{ name: 'Barghest', description: 'Fiendish wolf-like creatures' },
{ name: 'Greater Barghest', description: 'Mightier fiendish barghests' },
{ name: 'Basilisk', description: 'Stone-gazing reptilian monsters' },
{ name: 'Abyssal Greater Basilisk', description: 'Monstrous abyssal variant' },
{ name: 'Behir', description: 'Serpentine lightning-breathing creatures' },
{ name: 'Belker', description: 'Smoke-form elemental creatures' },
{ name: 'Blink Dog', description: 'Teleporting canine creatures' },
{ name: 'Bodak', description: 'Horrific undead beings' },
{ name: 'Bralani', description: 'Eladrin-like celestial creatures' },
{ name: 'Bugbear', description: 'Large, vicious goblinoids' },
{ name: 'Bulette', description: 'Burrowing, shark-like monsters' },
{ name: 'Celestial Creature', description: 'Celestial beings' },
{ name: 'Centaur', description: 'Humanoid with horse lower body' },
{ name: 'Chaos Beast', description: 'Ever-changing, chaotic creatures' },
{ name: 'Chimera', description: 'Multi-headed, hybrid monsters' },
{ name: 'Choker', description: 'Stalking, tentacled creatures' },
{ name: 'Chuul', description: 'Aquatic, crab-like monstrosities' },
{ name: 'Cloaker', description: 'Cloak-like, shadowy creatures' },
{ name: 'Cockatrice', description: 'Bird-like creatures with petrifying gaze' },
{ name: 'Couatl', description: 'Feathered serpentine celestial beings' },
{ name: 'Darkmantle', description: 'Ceiling-dwelling, dark creatures' },
{ name: 'Delver', description: 'Subterranean tunneling creatures' },
{ name: 'Demon', description: 'Chaotic evil fiends' },
{ name: 'Babau', description: 'Abyssal demon assassins' },
{ name: 'Balor', description: 'Demonic lords of destruction' },
{ name: 'Bebilith', description: 'Abyssal arachnid demons' },
{ name: 'Dretch', description: 'Lowly, chaotic demons' },
{ name: 'Glabrezu', description: 'Powerful, monstrous demons' },
{ name: 'Hezrou', description: 'Toad-like, foul demons' },
{ name: 'Marilith', description: 'Serpentine, multi-armed demons' },
{ name: 'Nalfeshnee', description: 'Grotesque, gluttonous demons' },
{ name: 'Quasit', description: 'Impish, chaotic demons' },
{ name: 'Retriever', description: 'Construct-like, demonic hunters' },
{ name: 'Succubus', description: 'Seductive, shape-shifting demons' },
{ name: 'Vrock', description: 'Vulture-like, chaotic demons' },
{ name: 'Derro', description: 'Mad, subterranean dwarf-like creatures' },
{ name: 'Destrachan', description: 'Sonic-wielding, blind subterranean creatures' },
{ name: 'Devil', description: 'Lawful evil fiends' },
{ name: 'Barbed Devil (Hamatula)', description: 'Thorn-covered devils' },
{ name: 'Bearded Devil (Barbazu)', description: 'Bearded, spear-wielding devils' },
{ name: 'Bone Devil (Osyluth)', description: 'Skeletal, manipulative devils' },
{ name: 'Chain Devil (Kyton)', description: 'Chain-wielding, torturous devils' },
{ name: 'Erinyes', description: 'Whip-wielding, tempting devils' },
{ name: 'Hellcat (Bezekira)', description: 'Fiendish cat-like creatures' },
{ name: 'Horned Devil (Cornugon)', description: 'Horned, brutal devils' },
{ name: 'Ice Devil (Gelugon)', description: 'Icy, spear-wielding devils' },
{ name: 'Imp', description: 'Tiny, mischievous devils' },
{ name: 'Lemure', description: 'Blob-like, lowly devils' },
{ name: 'Pit Fiend', description: 'Powerful, lordly devils' },
{ name: 'Devourer', description: 'Soul-consuming undead beings' },
{ name: 'Digester', description: 'Acid-spewing, monstrous creatures' },
{ name: 'Dinosaur', description: 'Prehistoric reptilian creatures' },
  { name: 'Deinonychus', description: 'Raptor-like, swift dinosaurs' },
{ name: 'Elasmosaurus', description: 'Long-necked, aquatic dinosaurs' },
{ name: 'Megaraptor', description: 'Giant, predatory theropods' },
{ name: 'Triceratops', description: 'Horned, herbivorous dinosaurs' },
{ name: 'Tyrannosaurus', description: 'Giant, fearsome carnivores' },
{ name: 'Dire Animal', description: 'Enormous, enhanced natural creatures' },
{ name: 'Dire Ape', description: 'Gigantic, powerful primates' },
{ name: 'Dire Badger', description: 'Huge, ferocious badgers' },
{ name: 'Dire Bat', description: 'Giant, winged mammals' },
{ name: 'Dire Bear', description: 'Massive, formidable bear creatures' },
{ name: 'Dire Boar', description: 'Huge, aggressive swine' },
{ name: 'Dire Lion', description: 'Majestic, enormous feline predators' },
{ name: 'Dire Rat', description: 'Giant, disease-carrying rodents' },
{ name: 'Dire Shark', description: 'Huge, ocean-dwelling predators' },
{ name: 'Dire Tiger', description: 'Powerful, immense tiger creatures' },
{ name: 'Dire Weasel', description: 'Large, deadly mustelids' },
{ name: 'Dire Wolf', description: 'Giant, pack-hunting wolves' },
{ name: 'Dire Wolverine', description: 'Ferocious, oversized weasels' },
{ name: 'Doppelganger', description: 'Shape-shifting, mimic creatures' },
{ name: 'Dragon, True', description: 'Majestic, elemental dragons' },
{ name: 'Chromatic Dragons', description: 'Evil-aligned elemental dragons' },
{ name: 'Black Dragon', description: 'Corrupting, swamp-dwelling dragons' },
{ name: 'Blue Dragon', description: 'Territorial, desert-dwelling dragons' },
{ name: 'Green Dragon', description: 'Deceptive, forest-dwelling dragons' },
{ name: 'Red Dragon', description: 'Destructive, volcanic dragons' },
{ name: 'White Dragon', description: 'Icy, cold-dwelling dragons' },
{ name: 'Metallic Dragons', description: 'Good-aligned elemental dragons' },
{ name: 'Brass Dragon', description: 'Talkative, desert-dwelling dragons' },
{ name: 'Bronze Dragon', description: 'Seafaring, ocean-dwelling dragons' },
{ name: 'Copper Dragon', description: 'Trickster, jungle-dwelling dragons' },
{ name: 'Gold Dragon', description: 'Noble, sun-dwelling dragons' },
{ name: 'Silver Dragon', description: 'Elegant, arctic-dwelling dragons' },
{ name: 'Dragon Turtle', description: 'Monstrous, aquatic dragonkin' },
{ name: 'Dragonne', description: 'Winged, lion-like creatures' },
{ name: 'Drider', description: 'Drow-spider hybrid creatures' },
{ name: 'Dryad', description: 'Woodland guardian spirits' },
{ name: 'Dwarf', description: 'Short and sturdy humanoids' },
{ name: 'Deep Dwarf', description: 'Subterranean, resilient dwarves' },
{ name: 'Duergar', description: 'Evil-aligned, dark dwarves' },
{ name: 'Mountain Dwarf', description: 'Highland-dwelling, stout dwarves' },
{ name: 'Eagle, Giant', description: 'Massive, majestic avian creatures' },
{ name: 'Elemental', description: 'Primordial elemental beings' },
{ name: 'Air Elemental', description: 'Whirling air creatures' },
{ name: 'Earth Elemental', description: 'Earthen, rocky creatures' },
{ name: 'Fire Elemental', description: 'Burning, fiery creatures' },
{ name: 'Water Elemental', description: 'Watery, fluid creatures' },
{ name: 'Elf', description: 'Graceful, long-lived humanoids' },
{ name: 'Half-Elf', description: 'Mixed elf and human heritage' },
{ name: 'Aquatic Elf', description: 'Sea-dwelling, aquatic elves' },
{ name: 'Drow', description: 'Dark-skinned, subterranean elves' },
{ name: 'Gray Elf', description: 'Mysterious, high elves' },
{ name: 'Wild Elf', description: 'Savage, primal forest elves' },
{ name: 'Wood Elf', description: 'Forest-dwelling, woodland elves' },
{ name: 'Ethereal Filcher', description: 'Dimension-hopping thieves' },
{ name: 'Ethereal Marauder', description: 'Ruthless ethereal raiders' },
{ name: 'Ettercap', description: 'Web-spinning, spider-like creatures' },
{ name: 'Ettin', description: 'Two-headed, brutish giants' },
{ name: 'Fiendish Creature', description: 'Creatures infused with fiendish essence' },
{ name: 'Formian', description: 'Ant-like insectoid creatures' },
{ name: 'Worker', description: 'Basic formian caste' },
{ name: 'Warrior', description: 'Formian warrior caste' },
{ name: 'Taskmaster', description: 'Formian taskmaster caste' },
{ name: 'Myrmarch', description: 'Formian ruler caste' },
{ name: 'Queen', description: 'Formian queen caste' },
{ name: 'Frost Worm', description: 'Icy, tunneling worm creatures' },
{ name: 'Fungus', description: 'Mushroom-like, fungal creatures' },
{ name: 'Shrieker', description: 'Audible alert fungal creatures' },
{ name: 'Violet Fungus', description: 'Tentacle-laden fungal creatures' },
{ name: 'Gargoyle', description: 'Stone guardians brought to life' },
{ name: 'Kapoacinth', description: 'Aquatic, stone-skinned creatures' },
{ name: 'Genie', description: 'Elemental beings of magic' },
{ name: 'Djinni', description: 'Air-dwelling genie beings' },
{ name: 'Noble Djinn', description: 'Mighty and noble air genies' },
{ name: 'Efreeti', description: 'Fire-dwelling genie beings' },
  { name: 'Ghaele', description: 'Celestial beings of beauty and grace' },
{ name: 'Ghost', description: 'Restless spirits of the deceased' },
{ name: 'Ghoul', description: 'Corpse-eating undead fiends' },
{ name: 'Lacedon', description: 'Aquatic, savage ghoul variant' },
{ name: 'Ghast', description: 'More powerful, horrifying undead' },
{ name: 'Giant', description: 'Enormous humanoid creatures' },
{ name: 'Cloud Giant', description: 'Sky-dwelling giants' },
{ name: 'Fire Giant', description: 'Molten lava-dwelling giants' },
{ name: 'Frost Giant', description: 'Glacial, ice-dwelling giants' },
{ name: 'Frost Giant Jarl', description: 'Mighty frost giant lords' },
{ name: 'Hill Giant', description: 'Huge, hill-dwelling giants' },
{ name: 'Stone Giant', description: 'Rock-skinned giants' },
{ name: 'Stone Giant Elders', description: 'Ancient, wise stone giants' },
{ name: 'Storm Giant', description: 'Majestic, storm-controlling giants' },
{ name: 'Gibbering Mouther', description: 'Mad, gibbering amalgamations' },
{ name: 'Girallon', description: 'Four-armed, gorilla-like creatures' },
{ name: 'Gnoll', description: 'Hyena-headed, savage humanoids' },
{ name: 'Gnome', description: 'Small, inventive humanoids' },
{ name: 'Svirfneblin', description: 'Subterranean deep gnomes' },
{ name: 'Forest Gnome', description: 'Nature-loving gnomes' },
{ name: 'Goblin', description: 'Small, mischievous humanoids' },
{ name: 'Golem', description: 'Artificial, construct creatures' },
{ name: 'Clay Golem', description: 'Mud and earth construct golems' },
{ name: 'Flesh Golem', description: 'Stitched together humanoid golems' },
{ name: 'Iron Golem', description: 'Metallic, powerful construct golems' },
{ name: 'Stone Golem', description: 'Rock and stone construct golems' },
{ name: 'Greater Stone Golem', description: 'Mighty stone construct golems' },
{ name: 'Gorgon', description: 'Metallic, bull-like creatures' },
{ name: 'Gray Render', description: 'Large, multi-limbed monstrosities' },
{ name: 'Grick', description: 'Tentacled, subterranean creatures' },
{ name: 'Griffon', description: 'Majestic, eagle-lion creatures' },
{ name: 'Grimlock', description: 'Blind, subterranean humanoids' },
{ name: 'Hag', description: 'Malevolent, monstrous spellcasters' },
{ name: 'Annis', description: 'Hideous, brute-like hags' },
{ name: 'Green Hag', description: 'Swamp-dwelling, cunning hags' },
{ name: 'Sea Hag', description: 'Oceanic, cruel hags' },
{ name: 'Half-Celestial', description: 'Celestial-infused mortals' },
{ name: 'Half-Dragon', description: 'Dragonblood-infused creatures' },
{ name: 'Half-Fiend', description: 'Fiendish-infused mortals' },
{ name: 'Halfling', description: 'Small, jovial humanoids' },
{ name: 'Tallfellow', description: 'Hobbit-like, stealthy halflings' },
{ name: 'Deep Halfling', description: 'Subterranean halfling variant' },
{ name: 'Harpy', description: 'Avian, seductive creatures' },
{ name: 'Harpy Archer', description: 'Harpy ranged attackers' },
{ name: 'Hell Hound', description: 'Infernal, fire-breathing hounds' },
{ name: 'Nessian Warhound', description: 'Hellish, inferno-dwelling hounds' },
{ name: 'Hippogriff', description: 'Horse-eagle hybrid creatures' },
{ name: 'Hobgoblin', description: 'Militaristic, goblinoid humanoids' },
{ name: 'Homunculus', description: 'Tiny, artificial humanoid constructs' },
{ name: 'Howler', description: 'Terrifying, sonic creatures' },
{ name: 'Hydra', description: 'Multi-headed, regenerating serpents' },
{ name: 'Pyrohydra', description: 'Fire-breathing, multi-headed hydra' },
{ name: 'Cryohydra', description: 'Cold-breathing, multi-headed hydra' },
{ name: 'Inevitable', description: 'Lawful enforcers of reality' },
{ name: 'Kolyarut', description: 'Inevitables of order and justice' },
{ name: 'Marut', description: 'Inevitables of final judgment' },
{ name: 'Zelekhut', description: 'Inevitables of pursuit and vengeance' },
{ name: 'Invisible Stalker', description: 'Unseen, air elemental creatures' },
{ name: 'Kobold', description: 'Small, cunning reptilian humanoids' },
{ name: 'Kraken', description: 'Gigantic, sea-dwelling monsters' },
{ name: 'Krenshar', description: 'Feline creatures with retractable faces' },
{ name: 'Lamia', description: 'Serpentine, enchanting monsters' },
{ name: 'Lammasu', description: 'Noble, celestial guardians' },
{ name: 'Golden Protector', description: 'Noble, golden lammasu' },
{ name: 'Leonal', description: 'Celestial lion guardians' },
{ name: 'Lich', description: 'Undead spellcasters seeking power' },
{ name: 'Lillend', description: 'Serpentine, musical celestial beings' },
{ name: 'Lizardfolk', description: 'Reptilian, tribal humanoids' },
  { name: 'Lizardfolk', description: 'Reptilian, tribal humanoids' },
{ name: 'Locathah', description: 'Aquatic, fish-like humanoids' },
{ name: 'Lycanthrope', description: 'Shape-changing, afflicted creatures' },
{ name: 'Werebear', description: 'Noble, bear-like lycanthropes' },
{ name: 'Wereboar', description: 'Savage, boar-like lycanthropes' },
{ name: 'Hill Giant Dire Wereboar', description: 'Monstrous hybrid' },
{ name: 'Wererat', description: 'Scheming, rat-like lycanthropes' },
{ name: 'Weretiger', description: 'Majestic, tiger-like lycanthropes' },
{ name: 'Werewolf', description: 'Savage, wolf-like lycanthropes' },
{ name: 'Werewolf Lord', description: 'Powerful alpha werewolves' },
{ name: 'Magmin', description: 'Fiery, elemental fire creatures' },
{ name: 'Manticore', description: 'Lion-bodied, spiked-tailed monsters' },
{ name: 'Medusa', description: 'Snake-haired, petrifying creatures' },
{ name: 'Mephit', description: 'Small, elemental creatures' },
{ name: 'Air Mephit', description: 'Airborne, mischievous mephits' },
{ name: 'Dust Mephit', description: 'Dust and sand-based mephits' },
{ name: 'Earth Mephit', description: 'Earthy and rocky mephits' },
{ name: 'Fire Mephit', description: 'Flaming and fiery mephits' },
{ name: 'Ice Mephit', description: 'Frosty and cold mephits' },
{ name: 'Magma Mephit', description: 'Molten lava-based mephits' },
{ name: 'Ooze Mephit', description: 'Slime and ooze-based mephits' },
{ name: 'Salt Mephit', description: 'Salt and desert-themed mephits' },
{ name: 'Steam Mephit', description: 'Steam and vapor-based mephits' },
{ name: 'Water Mephit', description: 'Aquatic and watery mephits' },
{ name: 'Merfolk', description: 'Aquatic, fish-like humanoids' },
{ name: 'Mimic', description: 'Shape-shifting, mimic creatures' },
{ name: 'Minotaur', description: 'Mighty, bull-headed creatures' },
{ name: 'Mohrg', description: 'Undead, corpse-animated creatures' },
{ name: 'Mummy', description: 'Ancient, desiccated undead' },
{ name: 'Mummy Lord', description: 'Mighty, lordly mummies' },
{ name: 'Naga', description: 'Serpentine, spellcasting beings' },
{ name: 'Dark Naga', description: 'Serpentine, deceitful spellcasters' },
{ name: 'Guardian Naga', description: 'Serpentine, protective beings' },
{ name: 'Spirit Naga', description: 'Serpentine, spirit-controlling beings' },
{ name: 'Water Naga', description: 'Serpentine, aquatic spellcasters' },
{ name: 'Night Hag', description: 'Evil, dream-invading hags' },
{ name: 'Nightmare', description: 'Nightmarish, demonic steeds' },
{ name: 'Cauchemar', description: 'Fiery, demonic nightmares' },
{ name: 'Nightshade', description: 'Shadowy, undead beings' },
{ name: 'Nightcrawler', description: 'Shadowy, stealthy undead' },
{ name: 'Nightwalker', description: 'Giant, shadowy undead' },
{ name: 'Nightwing', description: 'Abyssal, winged undead' },
{ name: 'Nymph', description: 'Enchanting, nature spirits' },
{ name: 'Ogre', description: 'Brutish, giant humanoids' },
{ name: 'Ogre Barbarian', description: 'Savage, raging ogres' },
{ name: 'Merrow', description: 'Aquatic, brutish ogres' },
{ name: 'Ogre Mage', description: 'Cunning, spellcasting ogres' },
{ name: 'Ooze', description: 'Amorphous, blob-like creatures' },
{ name: 'Black Pudding', description: 'Acidic, corrosive oozes' },
{ name: 'Elder Black Pudding', description: 'Mighty, acidic oozes' },
{ name: 'Gelatinous Cube', description: 'Translucent, cube-shaped oozes' },
{ name: 'Gray Ooze', description: 'Sluggish, gray-colored oozes' },
  { name: 'Ochre Jelly', description: 'Yellow, acidic oozes' },
{ name: 'Oracle', description: 'Divine seers and prophets' },
{ name: 'Orca', description: 'Gigantic, oceanic dolphins' },
{ name: 'Otyugh', description: 'Foul, scavenging aberrations' },
{ name: 'Owlbear', description: 'Bizarre owl-bear hybrid creatures' },
{ name: 'Pegasus', description: 'Winged, celestial horse creatures' },
{ name: 'Phantom Fungus', description: 'Ghostly, fungal specters' },
{ name: 'Phase Spider', description: 'Dimension-hopping arachnids' },
{ name: 'Phoenix', description: 'Resurrecting, fiery avian beings' },
{ name: 'Pixie', description: 'Tiny, mischievous nature spirits' },
{ name: 'Porpoise', description: 'Intelligent, aquatic dolphins' },
{ name: 'Purple Worm', description: 'Enormous, burrowing earthworms' },
{ name: 'Quaggoth', description: 'Savage, subterranean humanoids' },
{ name: 'Quasit', description: 'Impish, chaotic demons' },
{ name: 'Raakshasa', description: 'Deceptive, fiendish shape-shifters who often appear as cat-like humanoids.' },
{ name: 'Rat', description: 'Small, common rodents' },
{ name: 'Dire Rat', description: 'Giant, disease-carrying rodents' },
{ name: 'Ravid', description: 'Energetic, aberrant creatures' },
{ name: 'Remorhaz', description: 'Huge, fiery centipede-like creatures' },
{ name: 'Retriever', description: 'Construct-like, demonic hunters' },
{ name: 'Roc', description: 'Gigantic, legendary avian creatures' },
{ name: 'Roper', description: 'Stalactite-like, cave-dwelling creatures' },
{ name: 'Rust Monster', description: 'Metal-corroding, insect-like creatures' },
{ name: 'Sahuagin', description: 'Aquatic, shark-like humanoids' },
{ name: 'Salamander', description: 'Fire-dwelling, elemental beings' },
{ name: 'Flamebrother', description: 'Fiery, cruel salamanders' },
{ name: 'Noble Salamander', description: 'Mighty and regal salamanders' },
{ name: 'Savage Species', description: 'Creatures of wild nature' },
{ name: 'Scorpionfolk', description: 'Scorpion-like humanoid creatures' },
{ name: 'Sea Cat', description: 'Aquatic, seafaring feline creatures' },
{ name: 'Sea Hag', description: 'Oceanic, cruel hags' },
{ name: 'Shadow', description: 'Dark, shadowy incorporeal beings' },
{ name: 'Shadow Mastiff', description: 'Shadowy, hound-like creatures' },
{ name: 'Shambling Mound', description: 'Plant-based, swampy creatures' },
{ name: 'Shield Guardian', description: 'Construct guardians of magic' },
{ name: 'Shocker Lizard', description: 'Electricity-charging reptiles' },
{ name: 'Skeleton', description: 'Undead, animated skeletal remains' },
{ name: 'Skum', description: 'Aquatic, fish-like humanoid creatures' },
{ name: 'Slaad', description: 'Chaotic, amphibious outsiders' },
{ name: 'Blue Slaad', description: 'Chaos-infused amphibians' },
{ name: 'Death Slaad', description: 'Lethal, chaos-spreading slaad' },
{ name: 'Gray Slaad', description: 'Mad, spellcasting slaad' },
{ name: 'Green Slaad', description: 'Frog-like, disease-spreading slaad' },
{ name: 'Red Slaad', description: 'Fire-breathing, destructive slaad' },
{ name: 'Solar', description: 'Radiant, celestial angelic beings' },
{ name: 'Spectre', description: 'Malevolent, ghostly undead' },
{ name: 'Sphinx', description: 'Riddle-posing, enigmatic creatures' },
{ name: 'Androsphinx', description: 'Noble, lion-headed sphinxes' },
{ name: 'Criosphinx', description: 'Ram-headed, cunning sphinxes' },
{ name: 'Gynosphinx', description: 'Elegant, human-headed sphinxes' },
{ name: 'Hieracosphinx', description: 'Hawk-headed, vigilant sphinxes' },
{ name: 'Spider Eater', description: 'Arachnid-hunting, tentacled creatures' },
{ name: 'Sprite', description: 'Tiny, playful nature spirits' },
{ name: 'Grig', description: 'Tiny, cricket-like sprites' },
{ name: 'Nixie', description: 'Aquatic, water-loving sprites' },
{ name: 'Pixie', description: 'Tiny, mischievous nature sprites' },
{ name: 'Sprite, Dark', description: 'Shadowy and secretive sprites' },
{ name: 'Sprite, Pixie, Pixie Queen', description: 'Mighty pixie monarch' },
{ name: 'Sprite, Sprite, Sea', description: 'Maritime, water-loving sprites' },
{ name: 'Sprite, Snow', description: 'Cold-dwelling, winter sprites' },
{ name: 'Sprite, Twigjack', description: 'Plant-like, forest sprites' },
{ name: 'Squid, Giant', description: 'Massive, oceanic cephalopods' },
{ name: 'Stegosaurus', description: 'Herbivorous, plated dinosaurs' },
{ name: 'Stirge', description: 'Blood-drinking, bat-like creatures' },
{ name: 'Tarrasque', description: 'Legendary, world-devouring creature' },
{ name: 'Thoon Hulk', description: 'Aberrant, tentacled monstrosities' },
{ name: 'Thri-Kreen', description: 'Insectoid, mantis-like humanoids' },
{ name: 'Titan', description: 'Mighty, giant celestial beings' },
{ name: 'Toad, Giant', description: 'Enormous, amphibious creatures' },
{ name: 'Treant', description: 'Majestic, ancient tree guardians' },
{ name: 'Troglodyte', description: 'Reptilian, subterranean humanoids' },
{ name: 'Troll', description: 'Regenerating, monstrous humanoids' },
{ name: 'Scrag', description: 'Aquatic trolls with seaweed-like hair' },
{ name: 'True Troll', description: 'Mighty, advanced troll variants' },
{ name: 'Umber Hulk', description: 'Subterranean, tunneling horrors' },
{ name: 'Vampire', description: 'Undead, blood-drinking immortals' },
{ name: 'Vampire, Vampire Spawn', description: 'Newly created vampires' },
{ name: 'Vampire, Vampire Lord', description: 'Mighty vampire rulers' },
{ name: 'Vampire, Nosferatu', description: 'Hideous, monstrous vampires' },
{ name: 'Vargouille', description: 'Fiendish, bat-like head creatures' },
{ name: 'Violet Fungus', description: 'Tentacle-laden fungal creatures' },
{ name: 'Vrock', description: 'Vulture-like, chaotic demons' },
{ name: 'Water Weird', description: 'Aquatic, elemental water spirits' },
{ name: 'Wight', description: 'Undead, life-draining creatures' },
{ name: 'Will-o\'-Wisp', description: 'Mysterious, flickering lights' },
{ name: 'Winter Wolf', description: 'Cold-breathing, wolf-like creatures' },
{ name: 'Worg', description: 'Giant, wolf-like creatures' },
{ name: 'Wraith', description: 'Spectral, life-draining undead' },
{ name: 'Wyvern', description: 'Winged, dragon-like creatures' },
{ name: 'Xorn', description: 'Earth-dwelling, elemental creatures' },
{ name: 'Zombie', description: 'Shambling, undead reanimated corpses' },
{ name: 'Zombie Lord', description: 'Powerful, necromantic undead lords' },
{ name: 'Zuggtmoy', description: 'Fungal Demon Queen' },
{ name: 'Hedrack', description: 'High Priest of the Elder Elemental Eye' },
{ name: 'Obmi', description: 'Duergar Weaponsmith' },
{ name: 'Ultraloth', description: 'Servants of the yugoloths' },
{ name: 'Balor', description: 'Demonic, fiery terror' },
// Add more monster races here
];

// Define monster classes
const monsterClasses = [
{ name: 'Warrior', hp: '10 + 1d8', description: 'Skilled in combat' },
{ name: 'Shaman', hp: '10 + 1d6', description: 'Mystical spellcasters' },
{ name: 'Assassin', hp: '10 + 1d8', description: 'Stealthy killers' },
      { name: 'Knight of Atinus', baseHP: 10 },
    { name: 'Knight of Atricles', baseHP: 11},
    { name: 'Knight of Urther', baseHP: 11},
    { name: 'Knight of Poena', baseHP: 10},
    { name: 'Knight of Atricles', baseHP: 11},
    { name: 'Wizard', baseHP: 6 },
    { name: 'Witch', baseHP: 6 }, 
    { name: 'Necromancer', baseHP: 6 }, 
    { name: 'Warlock', baseHP: 6 }, 
    { name: 'Sorcerer', baseHP: 6 }, 
    { name: 'Thief', baseHP: 8 }, 
    { name: 'Barbarian', baseHP: 11 },
    
// Add more monster classes here
];


function getRandomRace() {
const randomIndex = Math.floor(Math.random() * characterRaces.length);
return characterRaces[randomIndex];
}

function getRandomClass() {
const randomIndex = Math.floor(Math.random() * characterClasses.length);
return characterClasses[randomIndex];
}

function areItemsEqual(itemA, itemB) {
// Compare items after trimming whitespace and converting to lowercase
return itemA.trim().toLowerCase() === itemB.trim().toLowerCase();
}

// Define a global variable to store user input for character creation
let characterCreationInput = '';
let characterCreationStep = 0;
// Initialize charactersString
let charactersString = '';
// Initialize an array to store NPCs and Mortacia
let npcs = [];

// Function to initialize NPCs and Mortacia
function initializeNPCs() {
// Create NPCs and Mortacia only if the npcs array is empty
if (npcs.length === 0) {
  for (let i = 0; i < 5; i++) {
    const npc = createRandomNPC();
    npcs.push(npc);
  }

  // Create Mortacia
  const mortacia = createMortaciaNPC();
  npcs.push(mortacia);
}
}

// Function to display the character creation menu
function displayCharacterCreationMenu(step) {
switch (step) {
  case 1:
    return 'Step 1: Enter character name';
  case 2:
    return 'Step 2: Choose character sex (Male or Female)';
  case 3:
    return 'Step 3: Choose character race';
  case 4:
    return 'Step 4: Choose character class';
  case 5:
    return 'Press enter to begin the game in the Ruined Temple.';
  default:
    return 'Invalid character creation step';
}
}




/*// Function to handle character creation
async function createCharacter(updatedUserInput, updatedUserWords) {
// Local variables to store input for each step
let stepUserInput = updatedUserInput;
let stepUserWords = updatedUserWords;

async function promptForInput(prompt) {
  displayMessage(prompt);

  // Use local variables within this function
  userInput = stepUserInput;
  userWords = stepUserWords;

  return userInput; // Return the input
}

if (characterCreationStep === 1){
    character.Name = updatedUserInput;

}

switch (characterCreationStep) {
  case 1:
        
   // character.Name = await promptForInput('Step 1: Enter character name');
    //characterCreationStep++;
   // break;
  case 2:
    character.Sex = await promptForInput('Step 2: Choose character sex (Male or Female)');
    //characterCreationStep++;
    break;
  case 3:
    character.Race = await promptForInput('Step 3: Choose character race (Enter the race number)');
    // Handle character's race selection

    // Display character's class selection as a single message
    let raceSelectionMessage = 'Choose character\'s race:\n';
    
    const raceIndex = parseInt(character.Race) - 1;
    const selectedRace = characterRaces[raceIndex];

    characterRaces.forEach((race, index) => {
      raceSelectionMessage += `${index + 1}) ${race.name} - ${race.description}\n`;
    });

    displayMessage(raceSelectionMessage);
    
    // Calculate character HP based on class
    calculateCharacterRace(character, selectedRace);
    //characterCreationStep++;
    break;
  case 4:
    character.Class = await promptForInput('Step 4: Choose character class (Enter the class number)');

    // Convert user input to class index (assuming user input is a valid class number)
    const classIndex = parseInt(character.Class) - 1;
    const selectedClass = characterClasses[classIndex];

    // Display character's class selection as a single message
    let classSelectionMessage = 'Choose character\'s class:\n';

    characterClasses.forEach((cls, index) => {
      classSelectionMessage += `${index + 1}) ${cls.name} - ${cls.description}\n`;
    });

    displayMessage(classSelectionMessage);
    
    // Calculate character HP based on class
    calculateCharacterHP(character, selectedClass);

    // Increment the character creation step here
    //characterCreationStep++;
    break;
  case 5:
    let beginGame = await promptForInput('Press enter to begin the game in the Ruined Temple.')
}

characterCreationStep++;

// If character creation is complete, add the created character to the characters array
if (characterCreationStep > 4) {
  characters.push(character);

  // Update charactersString with the new character data
  charactersString = characters.map((char, index) => {
    return `Character ${index + 1}:
      Name: ${char.Name}
      Sex: ${char.Sex}
      Race: ${char.Race}
      Class: ${char.Class}
      Level: ${char.Level}
      XP: ${char.XP}
      HP: ${char.HP}
      MaxHP: ${char.MaxHP}`;
  }).join('\n');

  // Reset characterCreationStep to 0 to indicate that character creation is complete
  characterCreationStep = 0;
}

// Return character, userInput, and userWords
return { character, userInput, userWords };
}*/


// Function to check if character creation is in progress
function isCharacterCreationInProgress() {
return characterCreationStep !== 0 && characterCreationStep < 5;
}
// Function to calculate character HP based on class
function calculateCharacterHP(character, selectedClass) {
if (selectedClass && selectedClass.hp) {
  const hpRoll = Math.floor(Math.random() * 20) + 1; // Roll a 20-sided die
  const hpModifier = selectedClass.hp.match(/\d+/)[0]; // Extract the HP modifier from the class description
  character.Class = selectedClass.name;
  character.HP = eval(`${hpModifier} + ${hpRoll}`);
  character.MaxHP = character.HP;
} else {
  // Handle the case where selectedClass or selectedClass.hp is undefined
  console.error("Invalid selectedClass:", selectedClass);
}
}

// Function to calculate character HP based on class
function calculateCharacterRace(character, selectedRace, userInput) {
character.Race = selectedRace.name;
}

// Function to create Mortacia character and add her to npcsString
function createMortaciaNPC() {
// Calculate the initial HP value
const initialHP = 120 + rollDice(20);

const mortacia = {
  Name: 'Mortacia',
  Sex: 'Female',
  Race: 'Goddess',
  Class: 'Assassin-Fighter-Necromancer-Goddess',
  Level: 50,
  AC: 15,
  XP: 750000,
  HP: initialHP,
  MaxHP: initialHP, // Set MaxHP to the same value as HP
};

// Calculate NPC HP based on class
//calculateCharacterHP(mortacia);
return mortacia;

}

// ...

// Function to create Mortacia character
function createMortaciaCharacter() {
// Calculate the initial HP value
const initialHP = 120 + rollDice(20);

const character = {
  Name: 'Mortacia',
  Sex: 'Female',
  Race: 'Goddess',
  Class: 'Assassin-Fighter-Necromancer-Goddess',
  Level: 50,
  XP: 750000,
  AC: 15,
  HP: initialHP,
  MaxHP: initialHP, // Set MaxHP to the same value as HP
  Equipped: [] // Initialize an array to store equipped items
};

// Add the character to the characters array
characters.push(character);

return character;
return;
}

// Function to create Suzerain character
function createSuzerainCharacter() {
 // Calculate the initial HP value
const initialHP = 80 + rollDice(20);
const character = {
  Name: 'Suzerain',
  Sex: 'Male',
  Race: 'Human',
  Class: 'Knight of Atinus',
  Level: 25,
  AC: 12,
  XP: 375000,
  HP: initialHP, // HP = 80 + 1d20 hitpoints
  MaxHP: initialHP,
  Equipped: []// Max HP can be calculated if needed
};

// Add the character to the characters array
characters.push(character);

return character;
return;
}

function rollDice(sides) {
return Math.floor(Math.random() * sides) + 1;
}


// ...

// Function to handle the start menu and character creation
async function handleStartMenu(userInput) {

}

// Function to display a message in the chat log
function displayMessage(message) {
  let userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";

// Get the existing chat log
const chatLog = document.getElementById("chatlog");
const chatHistory = chatLog.innerHTML;

let userWords = userInput.split(/\s+/).map(word => word.toLowerCase()); 

// Update the chat log with the "Loading..." message below the existing content
chatLog.innerHTML = chatHistory + "<br><br>Loading...";

chatLog.innerHTML += "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
scrollToBottom();
}

// Function to get a random integer between min and max (inclusive)
function getRandomInt(min, max) {
return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to get a random sex (Male or Female)
function getRandomSex() {
const sexes = ["Male", "Female"];
const randomIndex = Math.floor(Math.random() * sexes.length);
return sexes[randomIndex];
}

let monstersInRoom = [];

function generateMonsterName(sex) {
// Define arrays of name components
const prefixes = [
  "Gor", "Zog", "Thrak", "Skar", "Morg", "Drak", "Vor", "Xar", "Nar", "Grok",
  "Zur", "Krag", "Hark", "Grim", "Lurk", "Bor", "Snag", "Kor", "Ral", "Zar"
];

const middleNames = [
  "na", "gul", "rok", "ash", "thok", "mok", "rak", "gok", "lug", "murg"
];

const suffixes = [
  "or", "on", "ar", "og", "ok", "orak", "rak", "ur", "ogar", "krag", "rag", "lur"
];

// Generate a random number of names (1 to 3)
const numNames = getRandomInt(1, 3);

// Initialize the name
let name = "";

// Generate each part of the name based on sex
for (let i = 0; i < numNames; i++) {
  // Add a prefix
  name += prefixes[getRandomInt(0, prefixes.length - 1)];

  // If it's not the last name, add a middle name for variety
  if (i !== numNames - 1) {
    name += middleNames[getRandomInt(0, middleNames.length - 1)];
    
    // Add a space after each name except the last one
    name += " ";
  }
}

// Add a suffix
name += suffixes[getRandomInt(0, suffixes.length - 1)];

// If the sex is female, add a feminine-sounding suffix
if (sex === "Female") {
  const feminineSuffixes = ["a", "ia", "ina"];
  name += feminineSuffixes[getRandomInt(0, feminineSuffixes.length - 1)];
}

return name;
}

function getRandomName(sex) {
// Define arrays of name components
const prefixes = [
  "Al", "Athr", "Aec", "Aed","Aer", "Ba", "Da", "Fa", "Ga", "Ha", "Ja", "Ka", "La", "Ma", "Na", "Pa", "Qa", "Ra", "Sa", "Ta", "Ua", "Va", "Wa", "Xa", "Ya", "Za", "Be", "De", "Fe", "Ge", "He", "Je", "Ke", "Le", "Me", "Ne", "Pe", "Qe", "Re", "Se", "Te", "Ue", "Ve", "We", "Xe", "Ye", "Ze", "Bi", "Di", "Fi", "Gi", "Hi", "Ji", "Ki", "Li", "Mi", "Ni", "Pi", "Qi", "Ri", "Si", "Ti", "Ui", "Vi", "Wi", "Xi", "Yi", "Zi", "Bo", "Do", "Fo", "Go", "Ho", "Jo", "Ko", "Lo", "Mo", "No", "Po", "Qo", "Ro", "So", "To", "Uo", "Vo", "Wo", "Xo", "Yo", "Zo", "Bu", "Du", "Fu", "Gu", "Hu", "Ju", "Ku", "Lu", "Mu", "Nu", "Pu", "Qu", "Ru", "Su", "Tu", "Uu", "Vu", "Wu", "Xu", "Yu", "Zu", "By", "Dy", "Fy", "Gy", "Hy", "Jy", "Ky", "Ly", "My", "Ny", "Py", "Qy", "Ry", "Sy", "Ty", "Vy", "Wy", "Xy", "Zy", "Bre", "Beck", "Bel", "Ca", "Cat", "Cadre", "Dav", "Dra", "Drac", "Drag", "Draca",  "El", "Thel", "Ar", "Bal", "Ber", "Cal", "Cael", "Dor", "Eil", "Fen", "Gael", "Hal", "Ili", "Kor", "Lan", "Mal", "Nel", "Ol", "Pra", "Plur", "Quin", "Ral", "Rom", "Romn", "Sel", "Tal", "Urm", "Var", "Vor", "Wil", "Xan", "Yel", "Zel", "Zal", "Xera", "Xena", "Zul", "Kaal", "Maal", "Now", "Jack", "Ver", "Gor", "Zog", "Thrak", "Skar", "Morg", "Drak", "Vor", "Xar", "Nar", "Grok", "Zur", "Krag", "Hark", "Grim", "Lurk", "Bor", "Snag", "Kor", "Ral", "Zar"
];

const middleNames = [
  "a", "e", "i", "o", "u", "ae", "ei", "ea", "en", "in", "em", "ou", "ie", "oo", "ai", "al", "ui", "ul", "oi", "na", "gul", "rok", "ash", "thok", "mok", "rak", "gok", "lug", "murg"
];

const suffixes = [
  "ar", "en", "on", "an", "or", "ir", "us", "ad", "el", "ell", "en", "em", "ia", "ius", "orin", "ius", "in", "ius", "th", "ius", "anor", "as", "elle", "len", "lyn", "ion", "ael", "aela", "ius", "tas", "or", "on", "ar", "og", "ok", "orak", "rak", "ur", "ogar", "krag", "rag", "lur"
];

// Generate a random number of names (1 to 3)
const numNames = getRandomInt(1, 3);

// Initialize the name
let name = "";

// Generate each part of the name based on sex
for (let i = 0; i < numNames; i++) {
  // Add a prefix
  name += prefixes[getRandomInt(0, prefixes.length - 1)];

  // If it's not the last name, add a middle name for variety
  if (i !== numNames - 1) {
    name += middleNames[getRandomInt(0, middleNames.length - 1)];
    
    // Add a space after each name except the last one
    name += " ";
  }
}

// Add a suffix
name += suffixes[getRandomInt(0, suffixes.length - 1)];

// If the sex is female, add a feminine suffix
if (sex === "Female") {
  const feminineSuffixes = ["a", "ina", "elle", "aia", "ira"];
  name += feminineSuffixes[getRandomInt(0, feminineSuffixes.length - 1)];
}

return name;
}


// Function to create a random NPC character
function createRandomNPC() {
const randomName = getRandomName(); // You need to define a function to generate random names
const randomSex = getRandomSex(); // You need to define a function to generate random sexes
const randomRaceIndex = Math.floor(Math.random() * characterRaces.length);
const randomClassIndex = Math.floor(Math.random() * characterClasses.length);
const randomRace = characterRaces[randomRaceIndex];
const randomClass = characterClasses[randomClassIndex];
const npc = {
  Name: randomName,
  Sex: randomSex,
  Race: randomRace.name,
  Class: randomClass.name,
  Level: 1,
  AC: 10,
  XP: 0,
};
// Calculate NPC HP based on class
calculateCharacterHP(npc, randomClass);
return npc;
}

// Define keywords to include
const includeKeywords = [ 
"Coordinates:", "Exits:", "Objects in Room:", "Inventory:", "Turns:", // Add any other keywords you want to include
];

// Function to filter lines to include only those with the specified keywords
function includeOnlySpecifiedLines(text) {
const lines = text.split('\n');
const includedLines = lines.filter(line => includeKeywords.some(keyword => line.includes(keyword)));
return includedLines.join('\n');
}
// Define keywords to exclude
/*const excludeKeywords = [ 
"Seed:", "Room Description:", "Score:", "Artifacts Found:", "Quests Achieved:" , "PC:", "NPCs:", "Name:", "Sex:", "Race:", "Class:", "Level:", "XP:", "HP:", "MaxHP:", "Rooms Visited:", "Connected Rooms:"
];

// Assuming char is an object with properties
const char = {
Name: "CharacterName",
Sex: "CharacterSex",
Race: "CharacterRace",
Class: "CharacterClass"
};

// Extract property values and create an array to store variable values to exclude
const variablesToExclude = Object.values(char);

// Concatenate the two arrays
const allExcludedKeywords = excludeKeywords.concat(variablesToExclude);

// Function to remove lines with excluded keywords
function removeExcludedLines(text) {
const lines = text.split('\n');
const filteredLines = lines.filter(line => !allExcludedKeywords.some(keyword => line.includes(keyword)));
return filteredLines.join('\n');
}*/

let gameMode = [];


const retort = require('retort-js').retort;

const run = require('retort-js').run;

async function chatbotprocessinput(textin) {
let userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";

// Get the existing chat log
const chatLog = document.getElementById("chatlog");
const chatHistory = chatLog.innerHTML;

// Update the chat log with the "Loading..." message below the existing content
chatLog.innerHTML = chatHistory + "<br><br>Loading...";

// Generate a conversation ID or retrieve an existing one
let conversationId = localStorage.getItem("conversationId");
if (!conversationId) {
  conversationId = generateConversationId();
  localStorage.setItem("conversationId", conversationId);
}

// Retrieve all prompts and responses for the conversation from the database
const promptAndResponses = await getPromptsAndResponsesForConversation(conversationId);


// Check if the current room has been searched already
const roomHistory = roomConversationHistories[coordinatesToString(currentCoordinates)];
let userWords = userInput.split(/\s+/).map(word => word.toLowerCase());  
// Check if the user input is "search room"

if (userWords.includes("search") && userWords.includes("room")) {  
  // Filter out any other words except "search" and "room"
  const filteredWords = userWords.filter(word =>
    ["search", "room"].includes(word.toLowerCase())
  );
  
  // Replace userWords with the filtered words
  userWords.length = 0;
  userWords.push(...filteredWords);
  
  // Update userInput with the modified userWords
  userInput = userWords.join(" ");
  
  // Update the input field with the modified userInput
  document.getElementById("chatuserinput").value = userInput;
} else if (["look", "investigate", "examine", "explore"].some(word =>
    userWords.includes(word)) && userWords.includes("room")) {
  // Replace synonymous words with "search" if "room" is present
  userWords[userWords.indexOf("room") - 1] = "search";
  userWords = userWords.filter(word =>
    ["search", "room"].includes(word.toLowerCase())
  );
  
  // Update userInput with the modified userWords
  userInput = userWords.join(" ");
  
  // Update the input field with the modified userInput
  document.getElementById("chatuserinput").value = userInput;
}

if (userWords.length >= 2 && userWords.slice(-2).join(" ").toLowerCase() === "search room") {
  
    if (roomHistory && roomHistory.some(entry => entry.prompts && entry.prompts.includes("search room"))) {
  // Room has already been searched, display a message and prevent further execution
  const message = "You have already searched this room.";
  chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
  scrollToBottom();
  return;
}
}

// Extract the gameConsole data from the promptAndResponses array
let gameConsoleData = null;
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    break;
  }
}

// If gameConsoleData is null, it means the gameConsole data was not found in the promptAndResponses
// In this case, we'll assume that the gameConsole is at the end of the array
if (!gameConsoleData && promptAndResponses.length > 0) {
  const lastItem = promptAndResponses[promptAndResponses.length - 1];
  gameConsoleData = lastItem.response || lastItem.systemPrompt || lastItem.personalNarrative || lastItem.assistantPrompt;
}

// Parse user input to check for valid directions
const validDirections = ["north", "n", "south", "s", "east", "e", "west", "w", "northeast", "ne", "northwest", "nw", "southeast", "se", "southwest", "sw", "up", "u", "down", "d"];

// Update the currentCoordinates with the new coordinates after the user input
// Only update if there is a valid direction in the user input

// Initialize the conversation history
let conversationHistory = "";

// Construct the conversation history string
for (let i = 0; i < promptAndResponses.length; i++) {
if (promptAndResponses[i].gameConsole) {
  conversationHistory += `${promptAndResponses[i].prompt}\n${promptAndResponses[i].response}\n${promptAndResponses[i].gameConsole}\n`;
} else {
  conversationHistory += `${promptAndResponses[i].prompt}\n${promptAndResponses[i].response}\n`;
}
}

let validDirection = validDirections.find(direction => userWords.includes(direction));

gameConsoleData = null;
let exitsMatch = null;

let gameConsoleIndex = -1;


for (let i = promptAndResponses.length - 1; i >= 0; i--) {
if (promptAndResponses[i].gameConsole) {
  gameConsoleData = promptAndResponses[i].gameConsole;
  gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
  exitsMatch = gameConsoleData.match(/Exits: ([^\n]+)/);
  if (exitsMatch) {
    break; // Found the most recent gameConsole with exits
  }
}
}

let recentExits = [];
if (exitsMatch) {
recentExits = exitsMatch[1].split(", ");
}
if (validDirection) {
if (recentExits.includes(validDirection)) {
  // Update the coordinates based on the valid direction
  currentCoordinates = generateCoordinates(currentCoordinates, validDirection, gameConsoleData);
} else {
  // Respond with "You can't go that way."
  const message = "You can't go that way.";
  chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
  scrollToBottom();
  return; // Prevent further execution
}
}

gameConsoleData = null;
gameConsoleIndex = -1;
let objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
if (promptAndResponses[i].gameConsole) {
  gameConsoleData = promptAndResponses[i].gameConsole;
  gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
  objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
  if (objectsInRoomMatch.length > 0) {
    break; // Found the most recent gameConsole with "Objects in Room"
  }
}
}


let objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
// Split by comma and trim each item
}

console.log('objectsInRoomString:', objectsInRoomString);

// ... previous code

//    let character = null;
// Construct a string to represent all characters in the characters array
// Inside the updateGameConsole function
let charactersString = characters.map((char, index) => {
//  let equippedItems = char.Equipped.join(', '); // Get the equipped items
//  if (equippedItems.length < 1) {
//    equippedItems = "None"; // Add "Equipped" prefix
//  }
return `
  Name: ${char.Name}
  Sex: ${char.Sex}
  Race: ${char.Race}
  Class: ${char.Class}
  Level: ${char.Level}
  AC: ${char.AC}
  XP: ${char.XP}
  HP: ${char.HP}
  MaxHP: ${char.MaxHP}`;
//    Equipped: ${equippedItems}`;  Include the "Equipped" items in the string
}).join('\n');

// Define updatedUserInput and updatedUserWords
let updatedUserInput = userInput;
let updatedUserWords = userWords.slice(); // Copy the userWords array to avoid modifying the original

let raceIndex = parseInt(character.Race) - 1;
let selectedRace = characterRaces[raceIndex];
let classIndex = parseInt(character.Class) - 1;
let selectedClass = characterClasses[classIndex];

if (userWords[0] === '1' && charactersString.length <= 0) {
userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
userWords = "";
character = createMortaciaCharacter();
} else if (userWords[0] === '2' && charactersString.length <= 0) {
userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
userWords = "";
character = createSuzerainCharacter();
} else if (userWords[0] === "3" && charactersString.length <= 0) {
// Check if character creation is already in progress
if (!isCharacterCreationInProgress()) {
  // Start character creation by setting characterCreationStep to 1
  characterCreationStep = 1;
  displayMessage('Step 1: Enter character name'); // Display the first step
  console.log('charactersString:', charactersString);
  console.log('character:', character);
  return;
}
}

// If character creation is in progress, continue it
if (isCharacterCreationInProgress()) {
// Use characterCreationStep to determine which step to execute
switch (characterCreationStep) {
  case 1:
    character.Name = userInput;
    displayMessage('Step 2: Choose character sex (Male or Female)');
    characterCreationStep++;
    break;
  case 2:
    character.Sex = userInput;
    displayMessage('Step 3: Choose character race (Enter the race number)');
    
    // Display character's class selection as a single message
    let raceSelectionMessage = 'Choose character\'s race:\n';

    characterRaces.forEach((race, index) => {
      raceSelectionMessage += `${index + 1}) ${race.name} - ${race.description}\n`;
    });

    displayMessage(raceSelectionMessage);
    
    characterCreationStep++;
    break;
  case 3:
    character.Race = userInput; // Set the user's input as the character's race
    raceIndex = parseInt(character.Race) - 1;
    selectedRace = characterRaces[raceIndex];
  
    // Now that selectedRace is defined, call calculateCharacterRace
    calculateCharacterRace(character, selectedRace);
    
// Convert user input to class index (assuming user input is a valid class number)
      // Display character's class selection as a single message
      let classSelectionMessage = 'Choose character\'s class:\n';

      characterClasses.forEach((cls, index) => {
        classSelectionMessage += `${index + 1}) ${cls.name} - ${cls.description}\n`;
      });

      displayMessage(classSelectionMessage);

      characterCreationStep++;
      break;
    case 4:
      character.Class = userInput;
      classIndex = parseInt(character.Class) - 1;
      selectedClass = characterClasses[classIndex];
      // Calculate character HP based on class
      calculateCharacterHP(character, selectedClass);
// Character creation is complete, add the created character to the characters array
      characters.push(character);
      

    case 5:

      // Update charactersString with the new character data
      charactersString = characters.map((char, index) => {
        return `
          Name: ${char.Name}
          Sex: ${char.Sex}
          Race: ${char.Race}
          Class: ${char.Class}
          Level: ${char.Level}
          AC: ${char.AC}
          XP: ${char.XP}
          HP: ${char.HP}
          MaxHP: ${char.MaxHP}`;
      }).join('\n');
      
             if (characters.length === 1) {
      // Player wants to add NPCs to the party
//       const npcs = []; // Array to store NPCs

//       for (let i = 0; i < 5; i++) {
//          const npc = createRandomNPC();
//          npcs.push(npc);
//        }
      
      // Create Mortacia
//        const mortacia = createMortaciaNPC();
//       npcs.push(mortacia);

    // Call initializeNPCs once at the start of the game to populate the NPCs and Mortacia
initializeNPCs();
      
      const npcsString = npcs.map((char, index) => {
return `
    Name: ${char.Name}
    Sex: ${char.Sex}
    Race: ${char.Race}
    Class: ${char.Class}
    Level: ${char.Level}
    AC: ${char.AC}
    XP: ${char.XP}
    HP: ${char.HP}
    MaxHP: ${char.MaxHP}`;
}).join('\n');

      // Notify the user that NPCs have been added
      displayMessage('5 NPCs and Mortacia have joined your party.');

      // Include NPCs in charactersString
      charactersString += '\n' + npcs.map((char, index) => {
        return `NPC ${index + 1}:
          Name: ${char.Name}
          Sex: ${char.Sex}
          Race: ${char.Race}
          Class: ${char.Class}
          Level: ${char.Level}
          AC: ${char.AC}
          XP: ${char.XP}
          HP: ${char.HP}
          MaxHP: ${char.MaxHP}`;
      }).join('\n');
    }

      // Reset characterCreationStep to 0 to indicate that character creation is complete
      characterCreationStep = 0;

      // Inform the user that character creation is complete
      displayMessage('Character creation is complete. Press enter to begin the game in the Ruined Temple.');
      userInput = "Begin game with chosen character."
      break;
  }
  console.log('charactersString:', charactersString);
  console.log('character:', character);
  return;
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
if (promptAndResponses[i].gameConsole) {
  gameConsoleData = promptAndResponses[i].gameConsole;
  gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
  objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
  if (objectsInRoomMatch.length > 0) {
    break; // Found the most recent gameConsole with "Objects in Room"
  }
}
}


objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
// Split by comma and trim each item
}

if (userWords[0] === "start") {
userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
let character = null;
let startMenuOption = null;

// Display the start menu options in the chat log
displayMessage('Start Menu: \n \n 1) Play as Mortacia, goddess of death. \n 2) Play as Suzerain, knight of Atinus. \n 3) Create character and play as a party of 7 adventurers. \n');

// Handle the player's choice from the start menu
switch (userInput) {
  case '1':
      userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
    startMenuOption = 'Mortacia';
    character = await createCharacter('1'); // Handle Mortacia character creation
      userWords = "";
userInput = "";
    break;
    return;
  case '2':
      userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
    startMenuOption = 'Suzerain';
    character = await createCharacter('2'); // Handle Suzerain character creation
      userWords = "";
userInput = "";
    break;
    return;
  case '3':
      userInput = document.getElementById("chatuserinput").value;
document.getElementById("chatuserinput").value = "";
    startMenuOption = 'Create Character';
    character = await createCharacter('3'); // Handle character creation for a party of adventurers
    startMenuOption = null;
      userWords = "";
userInput = "";
    break;
    return;
}

// Once character creation is complete, you can proceed with the game
displayMessage(`You chose to ${startMenuOption}.`);

// Return the created character
return character;
}



if (userWords.length > 1 && userWords[0] === "take") {
const itemsToTake = userWords.slice(1).join(" ");

if (itemsToTake.toLowerCase() === "all") {
const newAdditionalEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);    
// Handle taking specific items as before (comma or "and" separated)
const itemsToTakeArray = itemsToTake.split(/, | and /); // Split by comma or "and"

// Find the matching console in promptAndResponses
const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;

let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
console.log('combinedEquipment:', combinedEquipment);

// Extract the "Objects in Room" part from combinedEquipment
objectsInRoomString = combinedEquipment.match(/Objects in Room: ([^\n]+)/);
if (objectsInRoomString) {
objectsInRoomString = objectsInRoomString[1];
} else {
objectsInRoomString = "None"; // Set a default value if "Objects in Room" is not found
}

// Split objectsInRoomString into an array of items
let itemsInRoom = objectsInRoomString.split(', ').map(item => item.trim());
console.log('itemsInRoom:', itemsInRoom);

if (objectsInRoomString.trim().toLowerCase() === "none" || !objectsInRoomString) {
const message = `The room is empty.`;
chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
scrollToBottom();
return; // Prevent further execution
}

  // Take all items in the room
  if (objectsInRoomString || itemsInRoom) {
  // Get newAdditionalEquipment from updateGameConsole

// Check if all items can be taken
const canTakeAllItems = itemsInRoom.every(item => {
return inventory.includes(item) || newAdditionalEquipment.includes(item);
});

if (canTakeAllItems) {
// Update inventory
inventory.push(...itemsInRoom);

inventory = removeNoneFromInventory(inventory);

// Remove taken items from combinedEquipment
combinedEquipment = combinedEquipment
  .split(/Objects in Room: ([^\n]+)/)
  .map(part => {
    if (part.includes("Objects in Room:")) {
      // Filter and join the remaining items
      const remainingItems = itemsInRoom.join(', ');
      return `Objects in Room: ${remainingItems}`;
    }
    return part;
  })
  .join('');

if (itemsInRoom.length === 0) {
  objectsInRoomString = "None"; // Set to "None" when there are no items left
}

console.log('objectsInRoomString:', objectsInRoomString);

// Update room equipment in the room's conversation history
const roomHistory = roomConversationHistories[coordinatesToString(currentCoordinates)];

if (roomHistory) {
  // Use the getFirstResponseForRoom function to get the first response
  const firstResponseForRoom = getFirstResponseForRoom(currentCoordinates);

  if (firstResponseForRoom) {
    // Remove sentences that mention the taken items from the first response
    itemsInRoom.forEach(item => {
      firstResponseForRoom.response = firstResponseForRoom.response.replace(new RegExp(`\\b${item}\\b`, 'gi'), '');
    });

// Update itemsInRoom and remove taken items
itemsInRoom = itemsInRoom.filter(item => !inventory.includes(item));

    // Update the game console data with the modified "Objects in Room"
    let updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    
    updatedGameConsole = gameConsoleData.replace(
      /Objects in Room: ([^\n]+)/,
      `Objects in Room: ${itemsInRoom.join(', ')}`
    );

    // Update the promptAndResponses array with the modified game console data
    promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

    // Update the conversation history with the modified game console data
    conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

    // Remove taken items from combinedEquipment
    combinedEquipment = combinedEquipment.replace(new RegExp(`\\b${itemsInRoom.join('\\b|\\b')}\\b`, 'gi'), '');

    itemsInRoom = itemsInRoom.length > 0 ? itemsInRoom : ["None"];
    console.log('itemsInRoom:', itemsInRoom);

    // Combine the game console, conversation history, and user input
    const combinedHistory = conversationHistory + "\n" + userInput;

    // Perform dynamic search using the Sentence Transformer model
    let personalNarrative = await performDynamicSearch(combinedHistory);

    // Construct the input message, including the previous response if it exists
    const messages = [
      { role: "assistant", content: "" },
      { role: "system", content: "" },
      { role: "user", content: userInput }
    ];

    const message = `Taken.`;
    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();
    // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
    addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);
    // Pass the updated game console to the database
    // Update the game console based on user inputs and get the updated game console
    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, itemsInRoom.join(', '));
    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    console.log("Game Console:", updatedGameConsole);
    console.log('itemsInRoom:', itemsInRoom);
    turns++;
    return;
  }
}
}
} 
} else {
// Handle taking specific items as before (comma or "and" separated)
const itemsToTakeArray = itemsToTake.split(/, | and /).map(item => item.trim()); // Split by comma or "and"

// Find the matching console in promptAndResponses
const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
let newAdditionalEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
console.log('combinedEquipment:', combinedEquipment);

// Extract the "Objects in Room" part from combinedEquipment
let objectsInRoomString = combinedEquipment.match(/Objects in Room: ([^\n]+)/);

if (objectsInRoomString) {
objectsInRoomString = objectsInRoomString[1].split(',').map(item => item.trim());
} else {
objectsInRoomString = ["None"]; // Set a default value if "Objects in Room" is not found
}
let itemsInRoom = objectsInRoomString.join(', ').split(', ').map(item => item.trim()); // Establish itemsInRoom

console.log('itemsInRoom:', itemsInRoom);

const invalidItems = itemsToTakeArray.filter(itemToTake => {
return !itemsInRoom.includes(itemToTake);
});

// Check if any of the items in itemsToTakeArray are already in the inventory
const itemsAlreadyInInventory = itemsToTakeArray.filter(item => inventory.includes(item));

if (!itemsInRoom.some(item => itemsToTakeArray.includes(item)) && itemsAlreadyInInventory.length > 0) {
const message = `You already have the ${itemsAlreadyInInventory.join(' and ')} in your inventory.`;
chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
scrollToBottom();
return; // Prevent further execution
}

if (invalidItems.length > 0) {
const message = `There is no ${invalidItems.join(' and ')} here.`;
chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
scrollToBottom();
return; // Prevent further execution
}

console.log('itemsInRoom:', itemsInRoom);

console.log('roomEquipment:', roomEquipment);
console.log('objectsInRoomString:', objectsInRoomString);

if (itemsInRoom.some(item => itemsToTakeArray.includes(item)) || newAdditionalEquipment.some(item => itemsToTakeArray.includes(item))) {
// Get newAdditionalEquipment from updateGameConsole

// Remove taken items from "Objects in Room"
itemsToTakeArray.forEach(item => {
  itemsInRoom = itemsInRoom.filter(roomItem => !itemsToTakeArray.includes(roomItem));
  objectsInRoomString = objectsInRoomString.filter(roomItem => !roomItem.includes(item.trim()));
});

// Check if there are items left in combinedEquipment
if (combinedEquipment.length === 0) {
  itemsInRoom = ["None"]; // Set to "None" when there are no items left
}

console.log('itemsInRoom:', itemsInRoom);

// Update inventory and room equipment
inventory.push(...itemsToTakeArray);

inventory = removeNoneFromInventory(inventory);

// Update room equipment in the room's conversation history
const roomHistory = roomConversationHistories[coordinatesToString(currentCoordinates)];
if (roomHistory) {
  // Use the getFirstResponseForRoom function to get the first response
  const firstResponseForRoom = getFirstResponseForRoom(currentCoordinates);

  if (firstResponseForRoom) {
    // Remove the sentence that mentions the taken items from the first response
    itemsToTakeArray.forEach(item => {
      firstResponseForRoom.response = firstResponseForRoom.response.replace(new RegExp(`\\b${item}\\b`, 'gi'), '');
    });

    // Update the game console data with the modified "Objects in Room"
    let updatedGameConsole = gameConsoleData.replace(
      /Objects in Room: ([^\n]+)/,
      `Objects in Room: ${objectsInRoomString.join(', ')}`
    );

    // Update the promptAndResponses array with the modified game console data
    promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

    // Update the conversation history with the modified game console data
    conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

    // Combine the game console, conversation history, and user input
    const combinedHistory = conversationHistory + "\n" + userInput;

    // Perform dynamic search using the Sentence Transformer model
    let personalNarrative = await performDynamicSearch(combinedHistory);

    // Construct the input message, including the previous response if it exists
    const messages = [
      { role: "assistant", content: "" },
      { role: "system", content: "" },
      { role: "user", content: userInput }
    ];

    const message = `Taken.`;
    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();
    // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
    addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

    // Update the game console based on user inputs and get the updated game console
    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
    console.log("Game Console:", updatedGameConsole);
    turns++;
    return;
  }
}
}
}
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
if (promptAndResponses[i].gameConsole) {
  gameConsoleData = promptAndResponses[i].gameConsole;
  gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
  objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
  if (objectsInRoomMatch.length > 0) {
    break; // Found the most recent gameConsole with "Objects in Room"
  }
}
}


objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
// Split by comma and trim each item
}

console.log('objectsInRoomString:', objectsInRoomString);

if (userWords.length > 1 && userWords[0] === "drop") {
const itemsToDrop = userWords.slice(1).join(" ");
const itemsToDropArray = itemsToDrop.split(/, | and /); // Split by comma or "and"

const invalidItems = itemsToDropArray.filter(item => {
  return !inventory.includes(item);
});

// Find the matching console in promptAndResponses
const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;

if (itemsToDrop.toLowerCase() === "all") {
  if (!inventory.length) {
    const message = `Your inventory is empty.`;
    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();
    return;
  }

  // Exclude the word "all" from itemsToDropArray
  const itemsToDropExcludingAll = itemsToDropArray.filter(item => item.toLowerCase() !== "all");

  // Check if objectsInRoomString is an array or a string
  if (Array.isArray(objectsInRoomString)) {
    objectsInRoomString = objectsInRoomString.join(", ");
  }

  // Append all items in inventory to objectsInRoomString
  if (itemsToDropExcludingAll.length > 0) {
    if (typeof objectsInRoomString === "string") {
      objectsInRoomString += ", " + itemsToDropExcludingAll.join(", ");
    } else {
      objectsInRoomString = itemsToDropExcludingAll.join(", ");
    }
  }

  if (inventory.length > 0) {
    if (typeof objectsInRoomString === "string") {
      objectsInRoomString += ", " + inventory.join(", ");
    } else {
      objectsInRoomString = inventory.join(", ");
    }
  }

  // Update the game console data with the modified "Objects in Room"
  let updatedGameConsole = gameConsoleData.replace(
    /Objects in Room: ([^\n]+)/,
    `Objects in Room: ${objectsInRoomString}`
  );

  // Update the promptAndResponses array with the modified game console data
  promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

  // Update the conversation history with the modified game console data
  conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

  inventory = []; // Clear the inventory

  if (typeof objectsInRoomString === "string") {
    itemsInRoom = objectsInRoomString.split(', ').map(item => item.trim());
  } else {
    itemsInRoom = ["None"];
  }

  // Combine the game console, conversation history, and user input
  const combinedHistory = conversationHistory + "\n" + userInput;

  // Perform dynamic search using the Sentence Transformer model
  let personalNarrative = await performDynamicSearch(combinedHistory);

  // Construct the input message, including the previous response if it exists
  const messages = [
    { role: "assistant", content: "" },
    { role: "system", content: "" },
    { role: "user", content: userInput }
  ];

  const message = `Dropped.`;
  chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
  scrollToBottom();
  // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
  addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);
  // Pass the updated game console to the database
  // Update the game console based on user inputs and get the updated game console
  updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
  conversationHistory = conversationHistory + "\n" + updatedGameConsole;
  console.log("Game Console:", updatedGameConsole);
  console.log('itemsInRoom:', itemsInRoom);
  turns++;
  return;
} else {
if (inventory.some(item => itemsToDropArray.includes(item))) {
inventory = inventory.filter(item => !itemsToDropArray.includes(item));

if (invalidItems.length > 0) {
  const message = `You don't have the ${invalidItems.join(", ")}.`;
  chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
  scrollToBottom();
  return;
}

// Check if objectsInRoomString is ["None"] and update it accordingly
if (objectsInRoomString.length === 1 && objectsInRoomString[0] === "None") {
  objectsInRoomString = itemsToDropArray.slice(); // Make a copy
} else {
  // Update objectsInRoomString to include the dropped items
  itemsToDropArray.forEach(item => {
    if (!objectsInRoomString.includes(item)) {
      objectsInRoomString.push(item);
    }
  });
}

// Update the game console data with the modified "Objects in Room"
let updatedGameConsole = gameConsoleData.replace(
  /Objects in Room: ([^\n]+)/,
  `Objects in Room: ${objectsInRoomString.join(', ')}`
);

// Update the promptAndResponses array with the modified game console data
promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

// Update the conversation history with the modified game console data
conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

itemsInRoom = objectsInRoomString;

// Combine the game console, conversation history, and user input
const combinedHistory = conversationHistory + "\n" + userInput;

// Perform dynamic search using the Sentence Transformer model
let personalNarrative = await performDynamicSearch(combinedHistory);

// Construct the input message, including the previous response if it exists
const messages = [
  { role: "assistant", content: "" },
  { role: "system", content: "" },
  { role: "user", content: userInput }
];

const message = `Dropped.`;
chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
scrollToBottom();

// Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

// Pass the updated game console to the database
// Update the game console based on user inputs and get the updated game console
updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
conversationHistory = conversationHistory + "\n" + updatedGameConsole;
console.log("Game Console:", updatedGameConsole);
console.log('itemsInRoom:', itemsInRoom);
turns++;
return;
  }
}
} 

// Check if the user input contains "ready" or "equip" followed by an item
const equipPattern = /^(ready|equip)\s+(.+)/i;
const equipMatch = userInput.match(equipPattern);

if (equipMatch) {
const equipAction = equipMatch[1].toLowerCase();
const equipItem = equipMatch[2].toLowerCase();

// Check if the equipItem is in the player's inventory
if (inventory.includes(equipItem)) {
  // Remove the item from the inventory
  inventory = inventory.filter(item => item !== equipItem);

  // Add the item to the equipped inventory
  equippedInventory.push(equipItem);

  // Add the item to the equipped section of the character
  characters[0].Equipped.push(equipItem);
    
    let updatedGameConsole = gameConsoleData;
     // Update the promptAndResponses array with the modified game console data
promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

// Update the conversation history with the modified game console data
conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

itemsInRoom = objectsInRoomString;

// Combine the game console, conversation history, and user input
const combinedHistory = conversationHistory + "\n" + userInput;

// Perform dynamic search using the Sentence Transformer model
let personalNarrative = await performDynamicSearch(combinedHistory);

// Construct the input message, including the previous response if it exists
const messages = [
  { role: "assistant", content: "" },
  { role: "system", content: "" },
  { role: "user", content: userInput }
];

const message = `\nYou have ${equipAction}ped the ${equipItem}.\n`;
chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
scrollToBottom();

// Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

// Pass the updated game console to the database
// Update the game console based on user inputs and get the updated game console
      // Update the game console with a message
    conversationHistory += `\nYou have ${equipAction}ped the ${equipItem}.\n`;
updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
conversationHistory = conversationHistory + "\n" + updatedGameConsole;
console.log("Game Console:", updatedGameConsole);
console.log('itemsInRoom:', itemsInRoom);
turns++;
return;
  } else {
      
      let updatedGameConsole = gameConsoleData;
      
             // Update the promptAndResponses array with the modified game console data
promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

// Update the conversation history with the modified game console data
conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

itemsInRoom = objectsInRoomString;

// Combine the game console, conversation history, and user input
const combinedHistory = conversationHistory + "\n" + userInput;

// Perform dynamic search using the Sentence Transformer model
let personalNarrative = await performDynamicSearch(combinedHistory);

// Construct the input message, including the previous response if it exists
const messages = [
  { role: "assistant", content: "" },
  { role: "system", content: "" },
  { role: "user", content: userInput }
];

const message = `\nYou don't have ${equipItem} in your inventory.\n`;
chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
scrollToBottom();

// Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

// Pass the updated game console to the database
// Update the game console based on user inputs and get the updated game console
      // Update the game console with a message
          // Update the game console with an error message
    conversationHistory += `\nYou don't have ${equipItem} in your inventory.\n`;
updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
conversationHistory = conversationHistory + "\n" + updatedGameConsole;
console.log("Game Console:", updatedGameConsole);
console.log('itemsInRoom:', itemsInRoom);
turns++;
return;
  }
}

// Update the game console based on user inputs and get the updated game console
let updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
console.log('updatedGameConsole:', updatedGameConsole);

conversationHistory = conversationHistory + "\n" + updatedGameConsole;

// Combine the game console, conversation history, and user input
const combinedHistory = conversationHistory + "\n" + userInput;

// Perform dynamic search using the Sentence Transformer model
let personalNarrative = await performDynamicSearch(combinedHistory);

  const messages = [
  { role: "assistant", content: "" },
  { role: "system", content: "" },
  { role: "user", content: userInput }
];

    // Add the personal narrative to the latest response (system prompt)
if (personalNarrative) {
  messages[1].content;
}

  fetch('http://childrenofthegrave.com/updateState2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalNarrative, updatedGameConsole }),
  })
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
  
//   var userInput = $('#chatuserinput').val(); // Get user input
  $.ajax({
    url: 'http://childrenofthegrave.com/processInput2', // Adjust this URL to your server's endpoint
    type: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ userInput: userInput }), // Send user input
    
    success: function(response) {
  // Directly access the 'content' part of the response

  let serverGameConsole = response.updatedGameConsole;
  console.log("serverGameConsole:", serverGameConsole); // Inspect the extracted part
  // Further code...

  // Parse new details from serverGameConsole
  let newRoomName = serverGameConsole.match(/Room Name: (.+)/)?.[1];
  let newRoomHistory = serverGameConsole.match(/Room Description: (.+)/)?.[1];
  let newObjectsInRoomString = serverGameConsole.match(/Objects in Room: (.+)/)?.[1];
  let newMonstersInRoomString = serverGameConsole.match(/Monsters in Room: (.*?)\s*$/m)?.[1]?.trim();;

// Update the game console with new room details and exits
updatedGameConsole = updatedGameConsole.replace(/Room Name: .*/, `Room Name: ${newRoomName}`);
updatedGameConsole = updatedGameConsole.replace(/Room Description: .*/, `Room Description: ${newRoomHistory}`);
updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${newObjectsInRoomString}`);
updatedGameConsole = updatedGameConsole.replace(/Monsters in Room: .*/, `Monsters in Room: ${newMonstersInRoomString}`);

  var content = response.response.content; // Adjust this based on the actual structure
  console.log("Server response:", response); // Debug log to inspect the structure
        console.log(content); // If you want to check the response as JSON
    // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
    addPromptAndResponse(userInput, messages[0].content, messages[1].content, response.response.content, personalNarrative, conversationId, updatedGameConsole);
    // Update the game console based on user inputs and get the updated game console

updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString, serverGameConsole);
//gameConsoleData = updatedGameConsole;


//updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString, serverGameConsole);

    console.log(updatedGameConsole);
    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
    turns++;
    
    // Apply the function to filter the lines you want to include
    const formattedUpdatedGameConsole = includeOnlySpecifiedLines(updatedGameConsole);
    console.log('formattedUpdatedGameConsole:', formattedUpdatedGameConsole);
    
    // Replace "\n" with "<br>" for line breaks
    const formattedConsoleWithLineBreaks = formattedUpdatedGameConsole.replace(/\n/g, "<br>");

  // Replace '\n' with '<br>' for correct HTML display
  var formattedContent = content.replace(/\n/g, '<br>');

  // Update chat log with the formatted content
  updateChatLog("<br><br><b> > </b>" + userInput + "<br><br><b></b>" + formattedContent + "<br><br>" + formattedConsoleWithLineBreaks);

  // Clear the user input field
  document.getElementById("chatuserinput").value = "";
},
    
    error: function(error) {
      console.log('Error:', error);
      updateChatLog("<br><b>Error:</b> Unable to get a response from the server.<br>");
    }
  });
} 

$(document).ready(function() {
  // Attach the chatbotprocessinput function to the input field's enter key event
  $('#chatuserinput').keydown(function(event) {
    if (event.keyCode == 13) { // Enter key
      event.preventDefault(); // Prevent default action (new line)
      chatbotprocessinput(); // Call the processing function
    }
  });
});


//const sharedState = require('./sharedState');

// Your game logic that updates personalNarrative and updatedGameConsole
// Example:
/*function updateGame(personalNarrative, updatedGameConsole) {
  // When you need to update the narrative or console data:
  sharedState.setPersonalNarrative("Updated personal narrative here");
  sharedState.setUpdatedGameConsole("Updated game console data here");

  // The rest of your game logic
}*/

module.exports = { chatbotprocessinput };
// Export any other functions or variables as needed