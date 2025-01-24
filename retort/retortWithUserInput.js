const { exec } = require('child_process');

const { json } = require('stream/consumers');

const retort = require('retort-js').retort;

const run = require('retort-js').run;

const axios = require('axios');

const { OpenAI } = require('openai');

//const client = new OpenAI();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 240000 // 2 minutes in milliseconds
});

// retortWithUserInput.js
const sharedState = require('../sharedState');

let assistant; // Global variable to store the assistant
let thread; // Global variable to store the thread

const characterClasses = [
    { name: 'Knight of Atinus', baseHP: 10 },
    { name: 'Knight of Atricles', baseHP: 12 },
    { name: 'Wizard', baseHP: 6 },
    { name: 'Witch', baseHP: 6 }, 
    { name: 'Necromancer', baseHP: 6 }, 
    { name: 'Warlock', baseHP: 4 }, 
    { name: 'Sorcerer', baseHP: 4 }, 
    { name: 'Thief', baseHP: 8 }, 
    { name: 'Assassin', baseHP: 8 }, 
    { name: 'Barbarian', baseHP: 12 },
    { name: 'Assassin-Fighter-Necromancer-Goddess', baseHP: 11 }, 
    // Add other classes here
];

async function generateImage(prompt) {
    const apiKey = process.env.OPENAI_API_KEY; // Ensure your API key is stored in the environment
    const url = "https://api.openai.com/v1/images/generations";

    try {
        const response = await axios.post(url, {
            prompt: prompt,
            n: 1,
            size: "1024x1024",
            model: "dall-e-3" // Specify DALL-E 3 model explicitly, if required
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            }
        });

        const imageUrl = response.data.data[0].url;
        return imageUrl;
    } catch (error) {
        console.error("Error generating image:", error.response ? error.response.data : error.message);
        throw new Error("Failed to generate image");
    }
}


let adjustedCharacters = [];
let adjustedNpcs = [];

function extractCharactersAndNpcs(updatedGameConsole) {
    const characters = [];
    const npcs = [];

    // Extract PC details
    const pcMatch = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/);
    if (pcMatch) {
        const pcDetails = pcMatch[1].trim();
        const pcLines = pcDetails.split('\n').map(line => line.trim());
        if (pcLines.length >= 14) {
            characters.push({
                Name: pcLines[0],
                Class: pcLines[3],
                Level: parseInt(pcLines[4].split(': ')[1]),
                XP: parseInt(pcLines[6].split(': ')[1]),
                HP: parseInt(pcLines[7].split(': ')[1]),
                MaxHP: parseInt(pcLines[8].split(': ')[1]),
                AC: parseInt(pcLines[5].split(': ')[1]),
                Attack: 0, // Default to 0, will be set by ensurePCProperties
                Damage: 0, // Default to 0, will be set by ensurePCProperties
                Armor: 0,  // Default to 0, will be set by ensurePCProperties
                Magic: 0,  // Default to 0, will be set by ensurePCProperties
                baseModifiersApplied: false, // Flag for base modifiers
            });
        }
    }

    // Extract NPC details
    const npcsMatch = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/);
    if (npcsMatch) {
        const npcsDetails = npcsMatch[1].trim();
        const npcsBlocks = npcsDetails.split(/\n(?=\w)/);  // Split by lines starting with a word character
        npcsBlocks.forEach(npcBlock => {
            const lines = npcBlock.trim().split('\n').map(line => line.trim());
            if (lines.length >= 14) {
                npcs.push({
                    Name: lines[0],
                    Class: lines[3],
                    Level: parseInt(lines[4].split(': ')[1]),
                    XP: parseInt(lines[6].split(': ')[1]),
                    HP: parseInt(lines[7].split(': ')[1]),
                    MaxHP: parseInt(lines[8].split(': ')[1]),
                    AC: parseInt(lines[5].split(': ')[1]),
                    Attack: 0, // Default to 0, will be set by ensureNPCProperties
                    Damage: 0, // Default to 0, will be set by ensureNPCProperties
                    Armor: 0,  // Default to 0, will be set by ensureNPCProperties
                    Magic: 0,  // Default to 0, will be set by ensureNPCProperties
                    baseModifiersApplied: false, // Flag for base modifiers
                });
            }
        });
    }

    return { characters, npcs };
}


// Function to roll a dice and sum results for each level above the current level
function rollTotalHP(currentLevel, newLevel, diceSize) {
  let hpTotal = 0;
  const levelsToRoll = newLevel - currentLevel;

  for (let i = 0; i < levelsToRoll; i++) {
    hpTotal += Math.floor(Math.random() * diceSize) + 1;
  }
  return hpTotal;
}

// Function to calculate XP thresholds that double per level until level 9, then increment at a fixed rate
function calculateXpThresholds(xpThreshold, level) {
    if (level < 9) {
        // Doubling per level until level 9
        return xpThreshold * Math.pow(2, level - 2);
    } else {
        // Fixed rate after level 9
        return xpThreshold * Math.pow(2, 7);
    }
}

// Function to determine the level based on XP
function calculateLevel(xp, xpThreshold, className) {
    let level = 1;
    let xpForNextLevel;

    while (true) {
        // Handle if xpThreshold is a function (for classes like "Assassin-Fighter-Necromancer-Goddess")
        if (typeof xpThreshold === 'function') {
            xpForNextLevel = xpThreshold(level);
        } else {
            xpForNextLevel = calculateXpThresholds(xpThreshold, level);
        }

        if (xp < xpForNextLevel) {
            break;
        }

        xp -= xpForNextLevel;
        level++;
    }

    return level;
}

const xpThresholds = {
    'Knight of Atinus': 1750,
    'Knight of Atricles': 2000,
    'Wizard': 2500,
    'Witch': 2500,
    'Necromancer': 2500,
    'Warlock': 3000,
    'Sorcerer': 3000,
    'Thief': 1500,
    'Assassin': 1500,
    'Barbarian': 2000,
    'Assassin-Fighter-Necromancer-Goddess': (level) => {
        if (level < 9) {
            return 3500 * Math.pow(2, level - 2);
        } else if (level >= 50 && level < 58) {
            return 3500 * Math.pow(2, level - 50); // Resetting thresholds
        } else {
            return 3500 * Math.pow(2, 7); // Fixed rate after level 9 or 57
        }
    }
};

// Define XP thresholds for different classes
/*const xpThresholds = {
    'Knight of Atinus': 12000,
    'Knight of Atricles': 13000,
    'Wizard': 14000,
    'Witch': 14000,
    'Necromancer': 14000,
    'Warlock': 16000,
    'Sorcerer': 16000,
    'Thief': 11000,
    'Assassin': 11000,
    'Barbarian': 12000,
    'Assassin-Fighter-Necromancer-Goddess': 15000,
    // Add other classes if needed
};*/

// Function to calculate increases based on the level difference
function calculateIncrease(currentLevel, newLevel, factor) {
    return Math.floor((newLevel - currentLevel) / factor);
}

// Ensure that PC properties exist and initialize them if not
function ensurePCProperties(char) {
    // Initialize the properties if not already set
    if (char.Attack === undefined) char.Attack = 0;
    if (char.Damage === undefined) char.Damage = 0;
    if (char.Armor === undefined) char.Armor = 0;
    if (char.Magic === undefined) char.Magic = 0;

    // Check if base modifiers have already been applied
    if (!char.baseModifiersApplied) {
        // Define base modifiers for each class
        const baseClassModifiers = {
            'Knight of Atinus': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Knight of Atricles': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Wizard': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Witch': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Necromancer': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Warlock': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Sorcerer': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Thief': { Attack: 0, Damage: 0, Armor: 1, Magic: 0 },
            'Assassin': { Attack: 1, Damage: 0, Armor: 0, Magic: 0 },
            'Barbarian': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Assassin-Fighter-Necromancer-Goddess': { Attack: 1, Damage: 1, Armor: -2, Magic: 5 },
            // Add other classes here
        };

        // Define base modifiers for each race
        const baseRaceModifiers = {
            'Human': { Attack: 0, Damage: 0, Armor: 0, Magic: 0 },
            'Dwarf': { Attack: 0, Damage: 1, Armor: 0, Magic: -1 },
            'High Elf': { Attack: -1, Damage: -1, Armor: 1, Magic: 2 },
            'Unseelie Elf': { Attack: -1, Damage:-1, Armor: 1, Magic: 2 },
            'Half-Elf': { Attack: -1, Damage: 0, Armor: 0, Magic: 1 },
            'Halfling': { Attack: -1, Damage: -1, Armor: 2, Magic: 0 },
            'Fey': { Attack: -1, Damage: -2, Armor: 0, Magic: 3 },
            'Raakshasa': { Attack: -1, Damage: 0, Armor: -1, Magic: 2 },
            'Gnome': { Attack: -1, Damage: -1, Armor: 0, Magic: 2 },
            // Add other races here
        };

        // Apply the base modifiers if the class and race are found
        const classModifiers = baseClassModifiers[char.Class];
        const raceModifiers = baseRaceModifiers[char.Race];

        if (classModifiers) {
            char.Attack += classModifiers.Attack;
            char.Damage += classModifiers.Damage;
            char.Armor += classModifiers.Armor;
            char.Magic += classModifiers.Magic;
        }

        if (raceModifiers) {
            char.Attack += raceModifiers.Attack;
            char.Damage += raceModifiers.Damage;
            char.Armor += raceModifiers.Armor;
            char.Magic += raceModifiers.Magic;
        }

        // Mark that base modifiers have been applied
        char.baseModifiersApplied = true;
    }
}

// Ensure that npc properties exist and initialize them if not
function ensureNPCProperties(npc) {
    // Initialize the properties if not already set
    if (npc.Attack === undefined) npc.Attack = 0;
    if (npc.Damage === undefined) npc.Damage = 0;
    if (npc.Armor === undefined) npc.Armor = 0;
    if (npc.Magic === undefined) npc.Magic = 0;

    // Check if base modifiers have already been applied
    if (!npc.baseModifiersApplied) {
        // Define base modifiers for each class
        const baseClassModifiers = {
            'Knight of Atinus': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Knight of Atricles': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Wizard': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Witch': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Necromancer': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Warlock': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Sorcerer': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Thief': { Attack: 0, Damage: 0, Armor: 1, Magic: 0 },
            'Assassin': { Attack: 1, Damage: 0, Armor: 0, Magic: 0 },
            'Barbarian': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Assassin-Fighter-Necromancer-Goddess': { Attack: 1, Damage: 1, Armor: -2, Magic: 5 },
            // Add other classes here
        };

        // Define base modifiers for each race
        const baseRaceModifiers = {
            'Human': { Attack: 0, Damage: 0, Armor: 0, Magic: 0 },
            'Dwarf': { Attack: 0, Damage: 1, Armor: 0, Magic: -1 },
            'High Elf': { Attack: -1, Damage: -1, Armor: 1, Magic: 2 },
            'Unseelie Elf': { Attack: -1, Damage:-1, Armor: 1, Magic: 2 },
            'Half-Elf': { Attack: -1, Damage: 0, Armor: 0, Magic: 1 },
            'Halfling': { Attack: -1, Damage: -1, Armor: 2, Magic: 0 },
            'Fey': { Attack: -1, Damage: -2, Armor: 0, Magic: 3 },
            'Raakshasa': { Attack: -1, Damage: 0, Armor: -1, Magic: 2 },
            'Gnome': { Attack: -1, Damage: -1, Armor: 0, Magic: 2 },
            // Add other races here
        };

        // Apply the base modifiers if the class and race are found
        const classModifiers = baseClassModifiers[npc.Class];
        const raceModifiers = baseRaceModifiers[npc.Race];

        if (classModifiers) {
            npc.Attack += classModifiers.Attack;
            npc.Damage += classModifiers.Damage;
            npc.Armor += classModifiers.Armor;
            npc.Magic += classModifiers.Magic;
        }

        if (raceModifiers) {
            npc.Attack += raceModifiers.Attack;
            npc.Damage += raceModifiers.Damage;
            npc.Armor += raceModifiers.Armor;
            npc.Magic += raceModifiers.Magic;
        }

        // Mark that base modifiers have been applied
        npc.baseModifiersApplied = true;
    }
}

function applyLevelAndHpAdjustments(updatedGameConsole) {
    const { characters, npcs } = extractCharactersAndNpcs(updatedGameConsole);

    characters.forEach(char => {
        const xpThreshold = xpThresholds[char.Class] || 3500;
        const newLevel = calculateLevel(char.XP, xpThreshold, char.Class);

        ensurePCProperties(char);

        const characterClasses = [
            { name: 'Knight of Atinus', baseHP: 10 },
            { name: 'Knight of Atricles', baseHP: 12 },
            { name: 'Wizard', baseHP: 6 },
            { name: 'Witch', baseHP: 6 },
            { name: 'Necromancer', baseHP: 6 },
            { name: 'Warlock', baseHP: 4 },
            { name: 'Sorcerer', baseHP: 4 },
            { name: 'Thief', baseHP: 8 },
            { name: 'Assassin', baseHP: 8 },
            { name: 'Barbarian', baseHP: 12 },
            { name: 'Assassin-Fighter-Necromancer-Goddess', baseHP: 11 },
        ];

        const characterClass = characterClasses.find(cls => cls.name === char.Class);

        let hpIncrease = 0;
        let attackIncrease = 0;
        let damageIncrease = 0;
        let armorIncrease = 0;
        let magicIncrease = 0;

        if (characterClass) {
            hpIncrease = rollTotalHP(char.Level, newLevel, characterClass.baseHP);
            attackIncrease = calculateIncrease(char.Level, newLevel, 5);
            damageIncrease = calculateIncrease(char.Level, newLevel, 7);
            armorIncrease = calculateIncrease(char.Level, newLevel, 10);
            magicIncrease = calculateIncrease(char.Level, newLevel, 1/2);
        }

        if (newLevel > char.Level) {
            char.Level = newLevel;
            char.AC = 10 + Math.floor(char.Level / 10);
            char.HP += hpIncrease;
            char.MaxHP += hpIncrease;
            char.Attack += attackIncrease;
            char.Damage += damageIncrease;
            char.Armor += armorIncrease;
            char.Magic += magicIncrease;

            console.log(`Updated ${char.Name} (Class: ${char.Class}) - Level: ${char.Level}, HP: ${char.HP}, MaxHP: ${char.MaxHP}, Attack: ${char.Attack}, Damage: ${char.Damage}, Armor: ${char.Armor}, Magic: ${char.Magic}`);
        }

        // Update the character details in the updatedGameConsole
        updatedGameConsole = updatedGameConsole.replace(
            new RegExp(`(PC:[\\s\\S]*?${char.Name}[\\s\\S]*?\\n\\s*HP:)\\s*\\d+`, 'g'),
            `$1 ${char.HP}`
        ).replace(
            new RegExp(`(PC:[\\s\\S]*?${char.Name}[\\s\\S]*?\\n\\s*MaxHP:)\\s*\\d+`, 'g'),
            `$1 ${char.MaxHP}`
        ).replace(
            new RegExp(`(PC:[\\s\\S]*?${char.Name}[\\s\\S]*?\\n\\s*Level:)\\s*\\d+`, 'g'),
            `$1 ${char.Level}`
        );
    });

    npcs.forEach(npc => {
        const xpThreshold = xpThresholds[npc.Class] || 3500;
        const newLevel = calculateLevel(npc.XP, xpThreshold, npc.Class);

        ensureNPCProperties(npc);

        const characterClasses = [
            { name: 'Knight of Atinus', baseHP: 10 },
            { name: 'Knight of Atricles', baseHP: 12 },
            { name: 'Wizard', baseHP: 6 },
            { name: 'Witch', baseHP: 6 },
            { name: 'Necromancer', baseHP: 6 },
            { name: 'Warlock', baseHP: 4 },
            { name: 'Sorcerer', baseHP: 4 },
            { name: 'Thief', baseHP: 8 },
            { name: 'Assassin', baseHP: 8 },
            { name: 'Barbarian', baseHP: 12 },
            { name: 'Assassin-Fighter-Necromancer-Goddess', baseHP: 11 },
        ];

        const characterClass = characterClasses.find(cls => cls.name === npc.Class);

        let hpIncrease = 0;
        let attackIncrease = 0;
        let damageIncrease = 0;
        let armorIncrease = 0;
        let magicIncrease = 0;

        if (characterClass) {
            hpIncrease = rollTotalHP(npc.Level, newLevel, characterClass.baseHP);
            attackIncrease = calculateIncrease(npc.Level, newLevel, 5);
            damageIncrease = calculateIncrease(npc.Level, newLevel, 7);
            armorIncrease = calculateIncrease(npc.Level, newLevel, 10);
            magicIncrease = calculateIncrease(npc.Level, newLevel, 1/2);
        }

        if (newLevel > npc.Level) {
            npc.Level = newLevel;
            npc.AC = 10 + Math.floor(npc.Level / 10);
            npc.HP += hpIncrease;
            npc.MaxHP += hpIncrease;
            npc.Attack += attackIncrease;
            npc.Damage += damageIncrease;
            npc.Armor += armorIncrease;
            npc.Magic += magicIncrease;

            console.log(`Updated ${npc.Name} (Class: ${npc.Class}) - Level: ${npc.Level}, HP: ${npc.HP}, MaxHP: ${npc.MaxHP}, Attack: ${npc.Attack}, Damage: ${npc.Damage}, Armor: ${npc.Armor}, Magic: ${npc.Magic}`);
        }

        // Update the NPC details in the updatedGameConsole
        updatedGameConsole = updatedGameConsole.replace(
            new RegExp(`(NPCs in Party:[\\s\\S]*?${npc.Name}[\\s\\S]*?\\n\\s*HP:)\\s*\\d+`, 'g'),
            `$1 ${npc.HP}`
        ).replace(
            new RegExp(`(NPCs in Party:[\\s\\S]*?${npc.Name}[\\s\\S]*?\\n\\s*MaxHP:)\\s*\\d+`, 'g'),
            `$1 ${npc.MaxHP}`
        ).replace(
            new RegExp(`(NPCs in Party:[\\s\\S]*?${npc.Name}[\\s\\S]*?\\n\\s*Level:)\\s*\\d+`, 'g'),
            `$1 ${npc.Level}`
        );
    });

    return updatedGameConsole;
}

// Function to restart gameServer2
function restartGameServer2() {
    return new Promise((resolve, reject) => {
        exec('pm2 restart gameServer4', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error restarting gameServer2: ${error.message}`);
                reject(error);
                return;
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
                resolve(stderr);
                return;
            }
            console.log(`stdout: ${stdout}`);
            resolve(stdout);
        });
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to roll a 1d20 and interpret the result
function roll1d20() {
    return Math.floor(Math.random() * 20) + 1;
}

// Function to determine the outcome based on the threshold and roll
function determineOutcome(threshold, roll) {
    return roll >= threshold ? 'successful' : 'unsuccessful';
}

async function getDelayedUpdatedGameConsole() {
    await delay(100);  // Delay for 3000 milliseconds (3 seconds)
    return sharedState.getUpdatedGameConsole();  // Fetch the updated game console after the delay
}

async function getDelayedPersonalNarrative() {
    await delay(100);  // Delay for 3000 milliseconds (3 seconds)
    return sharedState.getPersonalNarrative();  // Fetch the updated game console after the delay
}

async function getDelayedRoomNameDatabase() {
    await delay(100);  // Delay for 3000 milliseconds (3 seconds)
    return sharedState.getRoomNameDatabase();  // Fetch the updated game console after the delay
}

function mapToPlainObject(map) {
    const obj = {};
    for (const [key, value] of map.entries()) {
        obj[key] = value;
    }
    return obj;
}



// This function encapsulates your Retort-JS logic, now accepting dynamic input
async function retortWithUserInput(userInput) {
  let personalNarrative = await getDelayedPersonalNarrative();
    // Use the function to delay fetching the updatedGameConsole
  let updatedGameConsole = await getDelayedUpdatedGameConsole();
  let roomNameDatabaseString = await getDelayedRoomNameDatabase();
  let dialogueParts = personalNarrative.split('\n');
  
      // Using more cautious approach to parsing and handling undefined
    const roomNameMatch = updatedGameConsole.match(/Room Name: ([^\n]+)/);
    const roomDescriptionMatch = updatedGameConsole.match(/Room Description: ([^\n]+)/);
    const roomPuzzleMatch = updatedGameConsole.match(/Puzzle in Room: ([^\n]+)/);
    const puzzleSolutionMatch = updatedGameConsole.match(/Puzzle Solution: ([^\n]+)/);
    const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);

    // Only trim if match is found, otherwise default to empty string
    let roomName = roomNameMatch ? roomNameMatch[1].trim() : '';
    let roomDescription = roomDescriptionMatch ? roomDescriptionMatch[1].trim() : '';
    let puzzleDescription = roomPuzzleMatch ? roomPuzzleMatch[1].trim() : '';
    let puzzleSolution = puzzleSolutionMatch ? puzzleSolutionMatch[1].trim() : '';
    let roomExits = roomExitsMatch ? roomExitsMatch[1].trim() : '';

    console.log("Parsed roomName:", roomName);
    console.log("Parsed roomDescription:", roomDescription);
    console.log("Parsed roomExits:", roomExits);

// Helper functions
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomSex() {
  return Math.random() > 0.5 ? "Male" : "Female";
}

function coordinatesToString(coordinates) {
  return `X:${coordinates.x}, Y:${coordinates.y}, Z:${coordinates.z}`;
}

// Asynchronous function to handle dice rolls and adjudication
/*async function handleDiceRollsAndAdjudication($) {
    
 await $.assistant`
    You are an outcome adjudicator bot. 
    Take the player's action provided, and convert it into what dice need to be rolled and why and adjudicate the outcome, in the following JSON form:

    [
      {
        rollFor: "${userInput}"// What is the roll for? (string)
        diceFormula: //a dice notation dice formula
        numberRequiredForSuccess: // A number
      },
      ... etc
    ]
  and absolutely nothing else.`;
}*/

let attackDecision = "";

async function adjudicateAction($, updatedGameConsole) {
    
    let needsUpdate = false;
    
    // Using more cautious approach to parsing and handling undefined
    const roomNameMatch = updatedGameConsole.match(/Room Name: ([^\n]+)/);
    const roomDescriptionMatch = updatedGameConsole.match(/Room Description: ([^\n]+)/);
    const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);

    // Only trim if match is found, otherwise default to empty string
    let roomName = roomNameMatch ? roomNameMatch[1].trim() : '';
    let roomDescription = roomDescriptionMatch ? roomDescriptionMatch[1].trim() : '';
    let roomExits = roomExitsMatch ? roomExitsMatch[1].trim() : '';

    console.log("Parsed roomName:", roomName);
    console.log("Parsed roomDescription:", roomDescription);
    console.log("Parsed roomExits:", roomExits);
    
    let isAssistantMessage = false;
    let currentMessage = '';

    // Function to add the current message to the dialogue appropriately
    const addCurrentMessage = () => {
      if (currentMessage) { // Ensure the message is not empty
        if (isAssistantMessage) {
          $.assistant(currentMessage);
        } else {
          $.user(currentMessage);
        }
        currentMessage = ''; // Reset the current message
      }
    };
    
        
console.log("personalNarrative:", personalNarrative);
    for (let part of dialogueParts) {
      console.log("Processing part:", part); // Debugging log
      // Check if the part starts with user or assistant prompt correctly formatted
      if (part.match(/^\$\.(user|assistant) `\S/)) {
        // If there's an ongoing message, add it before starting a new one
        addCurrentMessage();
        // Determine if it's an assistant's or user's message
        isAssistantMessage = part.startsWith('$.assistant ');
        // Start capturing new message
        currentMessage = part.substring(part.indexOf('`') + 1).replace(/`$/, ''); // Remove leading and trailing backticks if present
      } else {
        // If it's a continuation without starting markers, add directly
        currentMessage += '\n' + part;
      }
    }
    
    addCurrentMessage();
    
    const npcActions = [];
    const monsterActions = [];

    const npcsInParty = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const monstersInRoom = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|$))/)?.[1]?.trim();

    console.log("NPCs in Party:", npcsInParty);
    console.log("Monsters in Room:", monstersInRoom);

    // Helper function to extract names by splitting the string into chunks of 14 lines
    const extractNames = (details) => {
        const lines = details.split('\n').map(line => line.trim());
        const names = [];
        for (let i = 0; i < lines.length; i += 14) {
            names.push(lines[i]); // Take the first line of each 14-line chunk
        }
        return names;
    };
    
    if (monstersInRoom && monstersInRoom.toLowerCase() !== 'none') {
        console.log("Monsters in Room:", monstersInRoom);

        // Parse HP values for all monsters
        const monsterHPRegex = /(?:^|\s)HP:\s*(-?\d+)(?:\s|$)/g; // Matches only standalone HP:
        const monsterHPValues = [];
        let match;

        while ((match = monsterHPRegex.exec(monstersInRoom)) !== null) {
            monsterHPValues.push(parseInt(match[1], 10)); // Collect HP as integers
        }

        console.log("Monster HP values:", monsterHPValues);

        // Check if all monsters have HP <= 0
        const allMonstersDefeated = monsterHPValues.every(hp => hp <= 0);

        if (allMonstersDefeated) {
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            $.user`All monsters in the room "${roomName}" have been defeated. The room is now clear. Store this information in memory and await the next prompt.`;

            return;
        }
    }
    
    // Handle Monsters in Room
    if (monstersInRoom && monstersInRoom.trim().toLowerCase() !== 'none' && monstersInRoom.trim() !== '') {
        const monsterNames = extractNames(monstersInRoom);

        for (const monsterName of monsterNames) {
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
   
            $.user`This is the ${roomName}'s description: "${roomDescription}" Store its contents and await the next prompt.`;
            const monstersState = updatedGameConsole.match(/Monsters State:([\s\S]*?)(?=(Rooms Visited|$))/)?.[1]?.trim();
            
                // Check if the monsters are hostile and decide whether they attack
    if (monstersState && monstersState.toLowerCase() === 'hostile') {
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;

        // Ask GPT if the monsters attack
        await $.user`The monsters are ${monstersState}. Do they "Attack" or "Doesn't Attack Yet"? Respond with only one of these words.`;

        const attackDecisionResult = await $.assistant.generation({
            parameters: {
                attack_decision: {type: String, enum: ["Attack", "Doesn't Attack Yet"]}
            }
        });

        attackDecision = attackDecisionResult.result.attack_decision.trim();

        if (attackDecision === "Attack") {
            console.log("Monsters decided to attack!");
            // If the monsters attack, handle the combat round
        //    await handleCombatRound($);

            // Stop further actions since combat has occurred
            return "The monsters attack the player, initiating combat!";
        } else {
            console.log("Monsters decided not to attack yet.");
            // If monsters don't attack, proceed to generate potential actions as usual
        }
    }
        }
    }

}

let truncatedResponse = "";
let sanitizedResponse = "";
let response = "";

async function sanitizeImage($) {
    console.log(`Sanitizing the image prompt...`);
    
    // Send the prompt to GPT-4 to sanitize it
    await $.user`Please rewrite the following prompt and remove only those parts that violate OpenAI's content policies for DALL-E 3, and otherwise reprint the rest of the prompt verbatim:\n\n${truncatedResponse}`;
    
    // Get the sanitized response
    const sanitizedResult = await $.assistant.generation();
    
    // Ensure the sanitized response is assigned to the sanitizedResponse variable
    sanitizedResponse = sanitizedResult.content.trim();
    
    console.log(`Sanitized response received: ${sanitizedResponse}`);
    
    return sanitizedResponse;
}

// Helper function to calculate cumulative XP
function calculateCumulativeXp(xpThreshold, level) {
    if (level < 2) {
        // Level 1 starts at 0 XP
        return 0;
    } else if (level <= 9) {
        // Cumulative XP doubles each level until level 9
        return xpThreshold * Math.pow(2, level - 2);
    } else {
        // Fixed increment after level 9
        const xpAtLevel9 = xpThreshold * Math.pow(2, 7); // XP at level 9
        const fixedIncrement = xpThreshold * Math.pow(2, 7); // Fixed increment (256,000)
        return xpAtLevel9 + fixedIncrement * (level - 9);
    }
}

async function generateMonstersForRoomUsingGPT($, roomName, roomDescription, roomCoordinates) {
    
// Extract Boss Room Coordinates if they exist
const bossRoomCoordinatesMatch = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
let bossRoomCoordinates = null;

if (bossRoomCoordinatesMatch) {
    bossRoomCoordinates = {
        x: parseInt(bossRoomCoordinatesMatch[1]),
        y: parseInt(bossRoomCoordinatesMatch[2]),
        z: parseInt(bossRoomCoordinatesMatch[3])
    };
    console.log("Extracted Boss Room Coordinates:", bossRoomCoordinates);
}

// Extract Current Room Coordinates
const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
if (currentCoordinatesMatch) {
    const currentCoordinates = {
        x: parseInt(currentCoordinatesMatch[1]),
        y: parseInt(currentCoordinatesMatch[2]),
        z: parseInt(currentCoordinatesMatch[3])
    };
    console.log("Extracted Current Room Coordinates:", currentCoordinates);

    // Check if current room matches the boss room coordinates
    const isBossRoom = bossRoomCoordinates &&
        currentCoordinates.x === bossRoomCoordinates.x &&
        currentCoordinates.y === bossRoomCoordinates.y &&
        currentCoordinates.z === bossRoomCoordinates.z;

    // Check if the player is at the starting coordinates (X: 0, Y: 0, Z: 0)
    const isStartingRoom = currentCoordinates.x === 0 && currentCoordinates.y === 0 && currentCoordinates.z === 0;

    // Extract NPCs in Party details
    const npcsInPartyMatch = updatedGameConsole.match(/NPCs in Party: ([^\n]+)/);
    const npcsInParty = npcsInPartyMatch ? npcsInPartyMatch[1].trim() : "None";
    const hasNpcsInParty = npcsInParty.toLowerCase() !== "none";

    if (isBossRoom) {
        console.log("Player has entered the boss room.");
        // Proceed to generate monsters (e.g., boss monster)
    } else if (isStartingRoom && hasNpcsInParty) {
        console.log("Player is at the starting coordinates with NPCs in party. No monsters encountered.");
        return; // No monsters generated in the starting room when NPCs are in the party
    } else {
        // 67% chance to generate monsters if not in the boss room or starting room with NPCs
        if (Math.random() > 0.67) {
            console.log("No monsters encountered this time.");
            return; // Exit function if no monsters are to be generated
        } else {
            console.log("Monsters encountered!");
            // Proceed to generate regular monsters
        }
    }
} else {
    console.error("Current room coordinates could not be extracted.");
}

    const numMonsters = getRandomInt(1, 4); // Random number of monsters
    const monsters = [];
    const monstersEquippedProperties = [];
    let monstersState = "";
    
    // Set monster XP threshold
    const monsterXpThreshold = 2000;
    
        // Extract characters and NPCs
    const { characters, npcs } = extractCharactersAndNpcs(updatedGameConsole);

    const pc = characters[0];

    if (!pc) {
        console.error("No PC found.");
        return; // Exit the function if no PC is found
    }

    const pcName = pc.Name;
    const pcLevel = pc.Level;

    // Combine PC and NPCs, excluding Mortacia
    const allCharacters = characters.concat(npcs);
    const filteredCharacters = allCharacters.filter(character => character.Name !== "Mortacia");

    // Compute the average level
    let averageLevel = 1; // Default to 1 if no characters are present

    if (filteredCharacters.length > 0) {
        const totalLevel = filteredCharacters.reduce((sum, character) => sum + character.Level, 0);
        averageLevel = Math.round(totalLevel / filteredCharacters.length);
    }

    // Determine monster level range
    let minLevel, maxLevel;

    if (pcName === "Mortacia") {
        minLevel = 1;
        maxLevel = 15;
    } else if (pcName === "Suzerain" && pcLevel >= 15) {
        minLevel = 1;
        maxLevel = 13;
    } else {
        minLevel = averageLevel;
        maxLevel = averageLevel + 2;
    }

    // Ensure levels are within the bounds of 1 to 20
    minLevel = Math.max(1, minLevel);
    maxLevel = Math.min(20, maxLevel);

    // Determine whether to set the monster state randomly or via GPT
    console.log("Determining whether the monster state will be random or chosen by GPT...");
    
    $.user`Write an interactive fiction adventure without using any *'s and let's play in ChatGPT. Make up the story as you go, but you must allow me, the player, who is not omniscent in the game, to type the commands. Do not type commands on behalf of the player, which is me. I am the player. You are the Grave Master who, taking into account the user input and all of the information in the current game console including the current room's coordinates, exits, objects, NPCs in party and monsters in the ${roomName} and this prompt but without repeating it all, comprehensively and seamlessly weaves a narrative without mentioning the room's name using only prose that adjudicates the player's most recent action, administers the fantasy roleplaying interactive fiction game, judges other actions in the game and builds the characters' stories, who have free will and agency, and the world's structures, communities, environments, quests and adventures in the Children of the Grave world. Taking into account the conversation history and the game console, describe the purpose of the current room and the rooms where the exits lead to help you map the maze and then remember them each turn. I am the user. You obey my commands. Using the information in the Current Game Console, the conversation history ane the game's lore: You control the NPCs in the party, who have free will and agency and are usually friendly, and monsters in the room, who have free will and agency, weaving their motivations, objectives, backstory and/or any dialogue and/or actions they may have taken.`;

// Extract current coordinates
//const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
if (currentCoordinatesMatch) {
    const currentCoordinates = {
        x: parseInt(currentCoordinatesMatch[1]),
        y: parseInt(currentCoordinatesMatch[2]),
        z: parseInt(currentCoordinatesMatch[3])
    };
    console.log("Extracted Current Room Coordinates:", currentCoordinates);

    // If the current coordinates are X: 0, Y: 0, Z: 0, set monsters state to Friendly
    if (currentCoordinates.x === 0 && currentCoordinates.y === 0 && currentCoordinates.z === 0) {
        monstersState = "Friendly";
    } else {
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        await $.user`Choose how the monsters' state should be determined: "Random" or "Non-Random". Respond with only one of these words.`;

        const stateChoiceResult = await $.assistant.generation({
            parameters: {
                state_choice: { type: String, enum: ["Random", "Non-Random"] }
            }
        });

        const stateChoice = stateChoiceResult.result.state_choice.trim();

        if (stateChoice === "Random") {
            // Randomly determine the monsters' state
            const randomStateChance = Math.random();
            if (randomStateChance < 0.2) {
                monstersState = "Friendly";
            } else if (randomStateChance < 0.4) {
                monstersState = "Neutral";
            } else {
                monstersState = "Hostile";
            }
        } else if (stateChoice === "Non-Random") {
            // Ask GPT to choose the state
            console.log("Asking GPT to choose the state...");
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            await $.user`Choose the monsters' state: "Friendly", "Neutral", or "Hostile". Respond with only one of these words.`;

            const stateResult = await $.assistant.generation({
                parameters: {
                    monster_state: { type: String, enum: ["Friendly", "Neutral", "Hostile"] }
                }
            });
            monstersState = stateResult.result.monster_state.trim();
        }
    }
}

    for (let i = 0; i < numMonsters; i++) {
        // Explicitly ask for race and class in a format that can be easily split
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        $.system`Room Name: ${roomName} Room Description: ${roomDescription}`;
        await $.assistant`Generate a fantasy race and class for an intelligent or unintelligent animal, monster, spirit or other NPC in ${roomName} from the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, formatted exactly as 'Race: [race], Class: [class] and nothing else with no line breaks.'`;
        const raceClassResult = await $.assistant.generation();
        console.log("Race and Class Result:", raceClassResult);

        if (!raceClassResult || !raceClassResult.content) {
            console.error("Failed to generate race and class for monster.");
            continue;
        }

        // Expecting the format "Race: [race], Class: [class]"
        const raceMatch = raceClassResult.content.match(/Race: (.*?),/);
        const classMatch = raceClassResult.content.match(/Class: (.*)/);
        if (!raceMatch || !classMatch) {
            console.error("Failed to parse race or class from the response:", raceClassResult.content);
            continue;
        }

        const generatedRace = raceMatch[1].trim().replace(/[^\w\s]/g, '');
        const generatedClass = classMatch[1].trim().replace(/[^\w\s]/g, '');
        const randomSex = getRandomSex();

        // Generate a name for the monster
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        await $.assistant`Generate a name for a ${randomSex} monster of the race ${generatedRace} and class ${generatedClass}.`;
        const nameResult = await $.assistant.generation();
        console.log(nameResult);

        if (!nameResult || !nameResult.content) {
            console.error("Failed to generate name for monster.");
            continue;
        }

        const monsterName = nameResult.content.replace(/^Name: /, '').trim().replace(/[^\w\s]/g, '');

        // Define level and calculate HP
        const randomLevel = getRandomInt(minLevel, maxLevel); // Level ranges from 1 to 20
        let hpTotal = 0;

        // Roll 1d10 for each level and sum the results
        for (let j = 0; j < randomLevel; j++) {
            hpTotal += getRandomInt(1, 11); // Roll 1d10 and add to total HP
        }

        //const xpTotal = 15000 * randomLevel;
        // Calculate cumulative XP required to reach the monster's level
        const xpTotal = calculateCumulativeXp(monsterXpThreshold, randomLevel);
        // Calculate AC starting at 10 and increasing by 1 for every ten levels
        const baseAC = 10;
        const acBonusPerTenLevels = Math.floor(randomLevel / 10);
        let totalAC = baseAC + acBonusPerTenLevels;

        const equipped = {
            Weapon: null,
            Armor: null,
            Shield: null,
            Other: null
        };

        const monster = {
            Name: monsterName,
            Sex: randomSex,
            Race: generatedRace,
            Class: generatedClass,
            Level: randomLevel,
            AC: totalAC,
            XP: xpTotal, // XP can be calculated or set as per game logic
            HP: hpTotal,
            MaxHP: hpTotal,
            Equipped: equipped,
            Attack: 0,
            Damage: 0,
            Armor: 0,
            Magic: 0,
        };

        // 50% chance of having items equipped
        if (Math.random() < 1.00) {
            const numItems = getRandomInt(1, 4); // Random number of items (1-3)
            for (let k = 0; k < numItems; k++) {
                const objectTypes = ['weapon', 'armor', 'shield', 'other'];
                const objectType = objectTypes[Math.floor(Math.random() * objectTypes.length)];

                $.model = "gpt-4o-mini";
                $.temperature = 1.0;
                await $.assistant`Generate a name for a ${objectType} as a portable object suitable for a fantasy, roleplaying adventure. The object should be all lower case on a single line with no punctuation, dashes, bullets, numbering or capitalization whatsoever, just the object as a noun. Object Type: ${objectType}.`;
                const objectResult = await $.assistant.generation();
                const objectName = objectResult.content.trim().toLowerCase();

                const object = { name: objectName, type: objectType };
                const objectModifiers = await generateObjectModifiers($, object);

                equipped[objectType === 'weapon' ? 'Weapon' : objectType === 'armor' ? 'Armor' : objectType === 'shield' ? 'Shield' : 'Other'] = {
                    ...object,
                    ...objectModifiers
                };

                // Update monster's stats based on equipped items
                if (objectModifiers) {
                    monster.Attack += objectModifiers.attack_modifier || 0;
                    monster.Damage += objectModifiers.damage_modifier || 0;
                    monster.Armor += objectModifiers.ac || 0;
                    monster.Magic += objectModifiers.magic || 0;
                }

                // Add equipped item to monstersEquippedProperties
                monstersEquippedProperties.push({
                    name: objectName,
                    type: objectType,
                    ...objectModifiers
                });
            }

            // Apply the total armor modifier to the monster's AC
            monster.AC += monster.Armor;
        }

        monsters.push(monster);
    }

    // Convert monsters array into a string with line breaks for each monster's details
    const monstersInRoomString = monsters.map(monster => {
        const equippedItemsString = Object.entries(monster.Equipped)
            .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
            .join(", ");
        monster.Equipped = equippedItemsString;
        return `${monster.Name}
      ${monster.Sex}
      ${monster.Race}
      ${monster.Class}
      Level: ${monster.Level}
      AC: ${monster.AC}
      XP: ${monster.XP}
      HP: ${monster.HP}
      MaxHP: ${monster.MaxHP}
      Equipped: ${monster.Equipped}
      Attack: ${monster.Attack}
      Damage: ${monster.Damage}
      Armor: ${monster.Armor}
      Magic: ${monster.Magic}`;
    }).join("\n");

    // Convert monstersEquippedProperties to a formatted string
    const monstersEquippedPropertiesString = monstersEquippedProperties.map(equip => `{name: "${equip.name}", type: "${equip.type}", attack_modifier: ${equip.attack_modifier}, damage_modifier: ${equip.damage_modifier}, ac: ${equip.ac}, magic: ${equip.magic}}`).join(', ');

    // Update the game console with new monsters and their equipped properties
    updatedGameConsole = updatedGameConsole.replace(/Monsters in Room: .*/, `Monsters in Room: \n${monstersInRoomString}`);
    updatedGameConsole = updatedGameConsole.replace(/Monsters Equipped Properties: .*/, `Monsters Equipped Properties: ${monstersEquippedPropertiesString}`);
    updatedGameConsole = updatedGameConsole.replace(/Monsters State: .*/, `Monsters State: ${monstersState}`);

}

async function generateRoomObjects($, roomName, roomDescription) {
    console.log(`Determining if there are objects for the ${roomName}...`);
    
    let updatedGameConsole = await getDelayedUpdatedGameConsole();

    const artifactMatch = updatedGameConsole.match(/Next Artifact: ([^\n]+)/);
    const questMatch = updatedGameConsole.match(/Current Quest: ([^\n]+)/);
    let nextArtifact = artifactMatch ? artifactMatch[1].trim() : '';
    let currentQuest = questMatch ? questMatch[1].trim() : '';

    const hasItems = Math.random() < 1.00;

    if (!hasItems) {
        console.log(`No items in the ${roomName}.`);
        const objects = [];
        return objects; // No items in the room
    }

    const numberOfItems = Math.floor(Math.random() * 5) + 1;
    console.log(`Generating ${numberOfItems} objects for the ${roomName}...`);
    
    const itemTypes = ['weapon', 'armor', 'shield', 'other'];
    const objects = [];
    
    for (let i = 0; i < numberOfItems; i++) {
        const objectType = itemTypes[Math.floor(Math.random() * itemTypes.length)];
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        await $.assistant`Generate a name for a ${objectType} as a portable object suitable for a fantasy, roleplaying adventure for the ${roomName}, with the object all lower case on a single line with no punctuation, dashes, bullets, numbering or capitalization whatsoever, just the object as a noun. Object Type: ${objectType} Room Description: ${roomDescription} If the object type is other, it might be a type of treasure that is wearable, a jewel, an orb, a relic or something readable like a scroll or tome. The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
        const objectResult = await $.assistant.generation();
        const objectName = objectResult.content.trim().toLowerCase();
        objects.push({ name: objectName, type: objectType });
    }

    return objects;
}

async function generateObjectModifiers($, object) {
    if (!object || !object.name || !object.type) {
        console.error("Invalid object provided to generateObjectModifiers", object);
        return {
            attack_modifier: 0,
            damage_modifier: 0,
            ac: 0,
            magic: 0
        };
    }

    const { name: objectName, type: objectType } = object;
    console.log(`Generating modifiers for the object: ${objectName}, which is a ${objectType}...`);

    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    await $.user`Provide the modifiers for "${objectName}" which is a ${objectType}. Respond in the format: "attack_modifier: W, damage_modifier: X, ac: Y, magic: Z" with a number 0, 1, 2 or 3. No other text.`;

    const modifiersResult = await $.assistant.generation({
        parameters: {
            attack_modifier: {type: Number, enum: [0, 1, 2, 3]},
            damage_modifier: {type: Number, enum: [0, 1, 2, 3]},
            ac: {type: Number, enum: [0, 1, 2, 3]},
            magic: {type: Number, enum: [0, 1, 2, 3]}
        }
    });

    const resultContent = modifiersResult.result; // Capture the assistant's result object
    console.log(`Received modifiers result: ${JSON.stringify(resultContent)}`);

    let attack_modifier = 0;
    let damage_modifier = 0;
    let ac = 0;
    let magic = 0;

    try {
        attack_modifier = resultContent.attack_modifier || 0;
        damage_modifier = resultContent.damage_modifier || 0;
        ac = resultContent.ac || 0;
        magic = resultContent.magic || 0;
    } catch (error) {
        console.error(`Failed to parse modifiers for object: ${objectName}`, error);
    }

    return {
        attack_modifier,
        damage_modifier,
        ac,
        magic
    };
}

// Handles entering the boss room, adds the next artifact, and generates the boss
async function handleBossRoom($) {
    let updatedGameConsole = await getDelayedUpdatedGameConsole();
    
    // Using more cautious approach to parsing and handling undefined
    const roomNameMatch = updatedGameConsole.match(/Room Name: ([^\n]+)/);
    const roomDescriptionMatch = updatedGameConsole.match(/Room Description: ([^\n]+)/);
    const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);
    const adjacentRoomsMatch = updatedGameConsole.match(/Adjacent Rooms: ([^\n]+)/);
    const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
    const exitsInRoomMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);

    // Only trim if match is found, otherwise default to empty string
    let roomName = roomNameMatch ? roomNameMatch[1].trim() : '';
    let roomDescription = roomDescriptionMatch ? roomDescriptionMatch[1].trim() : '';
    let roomExits = roomExitsMatch ? roomExitsMatch[1].trim() : '';
    let adjacentRooms = adjacentRoomsMatch ? adjacentRoomsMatch[1].trim() : '';
    let objectsInRoom = objectsInRoomMatch ? objectsInRoomMatch[1].trim() : '';
    let exitsInRoom = exitsInRoomMatch ? exitsInRoomMatch[1].trim() : '';
    
    console.log("Initial game console state:", updatedGameConsole);

    // Extract Boss Room Coordinates
        const bossRoomCoordinatesMatch = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
        if (bossRoomCoordinatesMatch) {
            const bossRoomCoordinates = {
                x: parseInt(bossRoomCoordinatesMatch[1]),
                y: parseInt(bossRoomCoordinatesMatch[2]),
                z: parseInt(bossRoomCoordinatesMatch[3])
            };
            console.log("Extracted Boss Room Coordinates:", bossRoomCoordinates);

            const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
            if (currentCoordinatesMatch) {
                const currentCoordinates = {
                    x: parseInt(currentCoordinatesMatch[1]),
                    y: parseInt(currentCoordinatesMatch[2]),
                    z: parseInt(currentCoordinatesMatch[3])
                };
                console.log("Extracted Current Room Coordinates:", currentCoordinates);

                // Check if current room is the boss room
        //        if (currentCoordinates.x === bossRoomCoordinates.x && currentCoordinates.y === bossRoomCoordinates.y && currentCoordinates.z === bossRoomCoordinates.z) {
                    console.log("Player has entered the boss room.");

                    // Extract Next Artifact and add to Objects in Room and Objects in Room Properties
                    const nextArtifactMatch = updatedGameConsole.match(/Next Artifact: ([^\n]+)/);
                    if (nextArtifactMatch) {
                        let nextArtifact = nextArtifactMatch[1].trim();
                        console.log("Next Artifact found:", nextArtifact);
                        let artifactObject = { name: nextArtifact, type: await determineArtifactType($, nextArtifact) };

                        // Generate artifact modifiers
                        const artifactModifiers = await generateObjectModifiers($, artifactObject);
                        artifactObject = { ...artifactObject, ...artifactModifiers };

                        // Add artifact to Objects in Room and Objects in Room Properties
                        let objectsInRoomArray = objectsInRoom ? objectsInRoom.split(',').map(item => item.trim()).filter(Boolean) : [];
                        objectsInRoomArray.push(nextArtifact);

                        updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${objectsInRoomArray.join(', ')}`);

                        let objectsInRoomProperties = updatedGameConsole.match(/Objects in Room Properties: (.*)/)[1].trim();
                        if (objectsInRoomProperties.toLowerCase() === "none") {
                            objectsInRoomProperties = [];
                        } else {
                            objectsInRoomProperties = objectsInRoomProperties.split(/},\s*{/).map(obj => `{${obj.replace(/^{|}$/g, '')}}`);
                        }
                        objectsInRoomProperties.push(`{name: "${artifactObject.name}", type: "${artifactObject.type}", attack_modifier: ${artifactObject.attack_modifier}, damage_modifier: ${artifactObject.damage_modifier}, ac: ${artifactObject.ac}, magic: ${artifactObject.magic}}`);

                        updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${objectsInRoomProperties.join(', ')}`);

                        console.log("Updated game console after adding artifact:", updatedGameConsole);
                    } else {
                        console.log("No artifact to add.");
                    }

                    // Extract Next Boss and generate the boss monster
                    const nextBossMatch = updatedGameConsole.match(/Next Boss: ([^\n]+)/);
                    if (nextBossMatch) {
                        const nextBoss = nextBossMatch[1].trim();
                        console.log("Next Boss found:", nextBoss);
                        updatedGameConsole = await generateBossMonster($, updatedGameConsole, nextBoss);
                        console.log("Updated game console after generating boss:", updatedGameConsole);
                    } else {
                        console.log("No boss to generate.");
                    }
                }
            }
    //    }

    return updatedGameConsole;
}

// Adds the next artifact to the room and updates room properties
async function addArtifactToRoom($, nextArtifact) {
    console.log(`Adding artifact ${nextArtifact} to the room...`);
    
    let updatedGameConsole = await getDelayedUpdatedGameConsole();

    // Determine artifact type using assistant and generate modifiers
    const artifactType = await determineArtifactType($, nextArtifact);
    let artifactObject = { name: nextArtifact, type: artifactType };

    // Generate artifact modifiers
    const artifactModifiers = await generateObjectModifiers($, artifactObject.name, artifactObject.type);
    artifactObject = Object.assign(artifactObject, artifactModifiers);

    // Update Objects in Room
    const objectsInRoom = updatedGameConsole.match(/Objects in Room: (.*)/);
    let objectsList = objectsInRoom ? objectsInRoom[1].split(',').map(item => item.trim()).filter(item => item.toLowerCase() !== 'none') : [];
    objectsList.push(artifactObject.name);

    updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${objectsList.join(', ')}`);

    // Update Objects in Room Properties without using JSON parsing
    const updatedObjectsInRoomProperties = updatedGameConsole.match(/Objects in Room Properties: (.*)/);
    let objectsInRoomProperties = updatedObjectsInRoomProperties ? updatedObjectsInRoomProperties[1].split(',').map(item => item.trim()).filter(item => item.toLowerCase() !== 'none') : [];
    objectsInRoomProperties.push(`{name: "${artifactObject.name}", type: "${artifactObject.type}", attack_modifier: ${artifactObject.attack_modifier}, damage_modifier: ${artifactObject.damage_modifier}, ac: ${artifactObject.ac}, magic: ${artifactObject.magic}}`);

    updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${objectsInRoomProperties.join(', ')}`);

    console.log("Updated game console after adding artifact:", updatedGameConsole);
    return updatedGameConsole;
}

// Determines the type of the artifact using assistant
async function determineArtifactType($, nextArtifact) {
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    await $.user`Determine the type of the artifact named "${nextArtifact}". The possible types are: weapon, armor, shield, or other. Respond with only the type.`;

    const typeResult = await $.assistant.generation({
        parameters: {
            type: { type: String, enum: ["weapon", "armor", "shield", "other"] }
        }
    });

    if (!typeResult || !typeResult.result || !typeResult.result.type) {
        console.error("Failed to determine artifact type for:", nextArtifact);
        return "other"; // Default to "other" if type cannot be determined
    }

    const artifactType = typeResult.result.type.trim();
    return artifactType;
}

// Generates the boss monster and adds it to Monsters in Room
async function generateBossMonster($, updatedGameConsole, bossName) {
    console.log(`Generating boss monster: ${bossName}...`);

    // Extract characters and NPCs
    const { characters, npcs } = extractCharactersAndNpcs(updatedGameConsole);
    const monstersEquippedProperties = [];
    
    // Set monster XP threshold
    const monsterXpThreshold = 2000;
    
    const pc = characters[0];

    if (!pc) {
        console.error("No PC found.");
        return updatedGameConsole; // Exit the function if no PC is found
    }

    const pcName = pc.Name;
    const pcLevel = pc.Level;

    // Combine PC and NPCs, excluding Mortacia
    const allCharacters = characters.concat(npcs);
    const filteredCharacters = allCharacters.filter(character => character.Name !== "Mortacia");

    // Compute the average level
    let averageLevel = 1; // Default to 1 if no characters are present

    if (filteredCharacters.length > 0) {
        const totalLevel = filteredCharacters.reduce((sum, character) => sum + character.Level, 0);
        averageLevel = Math.round(totalLevel / filteredCharacters.length);
    }

    // Determine boss level range
    let minLevel, maxLevel;

    if (pcName === "Mortacia") {
        minLevel = 1;
        maxLevel = 15;
    } else if (pcName === "Suzerain" && pcLevel >= 15) {
        minLevel = 1;
        maxLevel = 13;
    } else {
        minLevel = averageLevel;
        maxLevel = averageLevel + 4;
    }

    // Ensure levels are within the bounds of 1 to 20
    minLevel = Math.max(1, minLevel);
    maxLevel = Math.min(20, maxLevel);

    // Generate boss details
    const bossLevel = getRandomInt(minLevel, maxLevel) + 2;
    const bossHP = rollTotalHP(1, bossLevel, 12); // Example: Roll d12 for each level
    const bossAC = 10 + Math.floor(bossLevel / 2);

    // Generate boss sex, race, and class
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    await $.assistant`Generate a fantasy race and class for a powerful boss character named ${bossName} from the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise), high magical beings, and other entities of pure energy and form, angels, powerful demons. Format exactly as 'Race: [race], Class: [class]' and nothing else with no line breaks.`;
    const raceClassResult = await $.assistant.generation();
    console.log("Race and Class Result:", raceClassResult);

    if (!raceClassResult || !raceClassResult.content) {
        console.error("Failed to generate race and class for boss.");
        return updatedGameConsole;
    }

    const raceMatch = raceClassResult.content.match(/Race: (.*?),/);
    const classMatch = raceClassResult.content.match(/Class: (.*)/);
    if (!raceMatch || !classMatch) {
        console.error("Failed to parse race or class from the response:", raceClassResult.content);
        return updatedGameConsole;
    }

    const generatedRace = raceMatch[1].trim().replace(/[^\w\s]/g, '');
    const generatedClass = classMatch[1].trim().replace(/[^\w\s]/g, '');
    const randomSex = getRandomSex();
    
    // Calculate cumulative XP required to reach the monster's level
    const xpTotal = calculateCumulativeXp(monsterXpThreshold, bossLevel);
    // Calculate AC starting at 10 and increasing by 1 for every ten levels
    const baseAC = 10;
    const acBonusPerTenLevels = Math.floor(bossLevel / 10);
    let totalAC = baseAC + acBonusPerTenLevels;

    // Generate boss monster with random equipment
    const equipped = {
        Weapon: null,
        Armor: null,
        Shield: null,
        Other: null
    };
    
    const monster = {
        Name: bossName,
        Sex: randomSex,
        Race: generatedRace,
        Class: generatedClass,
        Level: bossLevel,
        AC: totalAC,
        XP: xpTotal, // XP can be calculated or set as per game logic
        HP: bossHP,
        MaxHP: bossHP,
        Equipped: equipped,
        Attack: 0,
        Damage: 0,
        Armor: 0,
        Magic: 0,
    };
    
    const numItems = getRandomInt(1, 4); // Random number of items (1-3)
    for (let k = 0; k < numItems; k++) {
        const objectTypes = ['weapon', 'armor', 'shield', 'other'];
        const objectType = objectTypes[Math.floor(Math.random() * objectTypes.length)];

        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        await $.assistant`Generate a name for a ${objectType} as a portable object suitable for a fantasy, roleplaying adventure. The object should be all lower case on a single line with no punctuation, dashes, bullets, numbering or capitalization whatsoever, just the object as a noun. Object Type: ${objectType}.`;
        const objectResult = await $.assistant.generation();
        const objectName = objectResult.content.trim().toLowerCase();

        const object = { name: objectName, type: objectType };
        const objectModifiers = await generateObjectModifiers($, object);

        equipped[objectType === 'weapon' ? 'Weapon' : objectType === 'armor' ? 'Armor' : objectType === 'shield' ? 'Shield' : 'Other'] = {
            ...object,
            ...objectModifiers
        };

        // Update monster's stats based on equipped items
        if (objectModifiers) {
            monster.Attack += objectModifiers.attack_modifier || 0;
            monster.Damage += objectModifiers.damage_modifier || 0;
            monster.Armor += objectModifiers.ac || 0;
            monster.Magic += objectModifiers.magic || 0;
        }

        // Add equipped item to monstersEquippedProperties
        monstersEquippedProperties.push({
            name: objectName,
            type: objectType,
            ...objectModifiers
        });
    }

    // Apply the total armor modifier to the monster's AC
    monster.AC += monster.Armor;

    // Prepare the monsters details for the game console
    const equippedItemsString = Object.entries(monster.Equipped)
        .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
        .join(", ");
    monster.Equipped = equippedItemsString;

    // Format the boss monster details for Monsters in Room
    const bossDetailsString = `${monster.Name}
      ${monster.Sex}
      ${monster.Race}
      ${monster.Class}
      Level: ${monster.Level}
      AC: ${monster.AC}
      XP: ${monster.XP}
      HP: ${monster.HP}
      MaxHP: ${monster.MaxHP}
      Equipped: ${monster.Equipped}
      Attack: ${monster.Attack}
      Damage: ${monster.Damage}
      Armor: ${monster.Armor}
      Magic: ${monster.Magic}`;

    // Update Monsters in Room in game console
    const monstersInRoomMatch = updatedGameConsole.match(/Monsters in Room: (.*)/);
    let monstersInRoom = monstersInRoomMatch ? monstersInRoomMatch[1].trim() : '';
    if (monstersInRoom === 'None') {
        monstersInRoom = bossDetailsString;
    } else {
        monstersInRoom = `${bossDetailsString}, ${monstersInRoom}`;
    }
    updatedGameConsole = updatedGameConsole.replace(/Monsters in Room: .*/, `Monsters in Room: ${monstersInRoom}`);

    // Convert monstersEquippedProperties to a formatted string and append to existing properties
    const monstersEquippedPropertiesMatch = updatedGameConsole.match(/Monsters Equipped Properties: (.*)/);
    let existingMonstersEquippedProperties = monstersEquippedPropertiesMatch && monstersEquippedPropertiesMatch[1].trim() !== 'None' ? monstersEquippedPropertiesMatch[1] : '';
    const monstersEquippedPropertiesString = monstersEquippedProperties.map(equip => `{name: "${equip.name}", type: "${equip.type}", attack_modifier: ${equip.attack_modifier}, damage_modifier: ${equip.damage_modifier}, ac: ${equip.ac}, magic: ${equip.magic}}`).join(', ');
    existingMonstersEquippedProperties = existingMonstersEquippedProperties ? `${existingMonstersEquippedProperties}, ${monstersEquippedPropertiesString}` : monstersEquippedPropertiesString;
    updatedGameConsole = updatedGameConsole.replace(/Monsters Equipped Properties: .*/, `Monsters Equipped Properties: ${existingMonstersEquippedProperties}`);

    // Set the monsters state to Hostile
    updatedGameConsole = updatedGameConsole.replace(/Monsters State: .*/, `Monsters State: Hostile`);

    console.log("Updated game console after generating boss:", updatedGameConsole);

    return updatedGameConsole;
}


async function generateMissingRoomDetails($, object) {
    let roomNameDatabaseString = await getDelayedRoomNameDatabase();
    let needsUpdate = false;
    let isAssistantMessage = false;
    let currentMessage = '';
    let roomDescriptionGenerated = false;

    // Function to add the current message to the dialogue appropriately
    const addCurrentMessage = () => {
      if (currentMessage) { // Ensure the message is not empty
        if (isAssistantMessage) {
          $.assistant(currentMessage);
        } else {
          $.user(currentMessage);
        }
        currentMessage = ''; // Reset the current message
      }
    };
        
console.log("personalNarrative:", personalNarrative);
    for (let part of dialogueParts) {
      console.log("Processing part:", part); // Debugging log
      // Check if the part starts with user or assistant prompt correctly formatted
      if (part.match(/^\$\.(user|assistant) `\S/)) {
        // If there's an ongoing message, add it before starting a new one
        addCurrentMessage();
        // Determine if it's an assistant's or user's message
        isAssistantMessage = part.startsWith('$.assistant ');
        // Start capturing new message
        currentMessage = part.substring(part.indexOf('`') + 1).replace(/`$/, ''); // Remove leading and trailing backticks if present
      } else {
        // If it's a continuation without starting markers, add directly
        currentMessage += '\n' + part;
      }
    }
    
    addCurrentMessage();
    
       // Using more cautious approach to parsing and handling undefined
    const roomNameMatch = updatedGameConsole.match(/Room Name: ([^\n]+)/);
    const roomDescriptionMatch = updatedGameConsole.match(/Room Description: ([^\n]+)/);
    const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);
    const adjacentRoomsMatch = updatedGameConsole.match(/Adjacent Rooms: ([^\n]+)/);
    const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
    const exitsInRoomMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);

    // Only trim if match is found, otherwise default to empty string
    let roomName = roomNameMatch ? roomNameMatch[1].trim() : '';
    let roomDescription = roomDescriptionMatch ? roomDescriptionMatch[1].trim() : '';
    let roomExits = roomExitsMatch ? roomExitsMatch[1].trim() : '';
    let adjacentRooms = adjacentRoomsMatch ? adjacentRoomsMatch[1].trim() : '';
    let objectsInRoom = objectsInRoomMatch ? objectsInRoomMatch[1].trim() : '';
    let exitsInRoom = exitsInRoomMatch ? exitsInRoomMatch[1].trim() : '';

    console.log("Parsed roomName:", roomName);
    console.log("Parsed roomDescription:", roomDescription);
    console.log("Parsed roomExits:", roomExits);
    console.log("Adjacent Rooms:", adjacentRooms);

    const roomExitsArray = roomExits.split(',').map(exit => exit.trim());
    let existingAdjacentRooms = adjacentRooms ? adjacentRooms.split(',').map(adj => adj.split(':')[0].trim()) : [];
    console.log("Existing Adjacent Rooms:", existingAdjacentRooms);

    // Only proceed if there is no room description
    if (roomExitsArray.length > existingAdjacentRooms.length || !roomDescription) {
        console.log("Room name missing, generating new details.");
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            $.system`Instructions: Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console and the die rolls, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go including imagining the names and histories of people, places and things encountered, but you must allow me, the player, to type the commands, allowing for potential failure. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game, while the Grave Master controls monsters and NPCs. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. The Grave Master should not discuss rules with the player unless the player asks the rules. The Grave Master's job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. Do not improvise the rules and mechanics laid out here. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading either outdoors into the wastelands of Tartarus or deeper into the temple, ultimately leading to the 1000th room, the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console below and using unique characters, plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. The monsters and NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn. The Grave Master should use this as inspiration: 'You have died and find yourself standing in the the first room in the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.'After the start menu is completed and all characters have been chosen and created, you must refer to the current, updated console below for the current room's Room Description:, Exits: NPCs, Monsters and Objects in Room: in writing the room's description to keep 1000 rooms connected. Proceed with the game when I have made my selections from the start menu of either Mortacia, goddess of death, Mortacia is (an 8 1/2 tall human-looking female with long blonde hair, large grey dragon wings that look slightly decayed with many holes and openings and can fly but not too far, and is on a quest to reclaim the Sepulchra to reclaim her throne in Hades, Suzerain, Knight of Atinus, the recurring hero of the Children of the Grave campaign setting who keeps having to save the world, die and go to the afterlife, raise an army of the dead souls to save the underworld plane of Hades from Arithus, and then be reborn again, who has just died and finds himself in the first room of the afterlife, or an adventuring party of seven adventurers named the Children of the Grave who have died and find themselves in the first room of the afterlife and been summoned by Mortacia, but who are unaware of their circumstances at first: 1 PC whom I direct, 5 NPCs you control and also Mortacia, who is also an NPC you control and joins the party, described herein, all the characters described herein have been created and I am in the Ruined Temple in Tartarus described herein and issued the command to proceed. Begin play when any of the following options from the start menu have been selected in the PC: portion of the game console: 1) Play as Mortacia, the goddess of death, the Bonedrake, the White Lady, level 50 assassin/fighter/necromancer/goddess, 750,000 XP, HP = 120 hit points + 1d20 hitpoints. 2) Play as Suzerain, a human male level 25 Knight of Atinus the God of War (Atinus is the god of war, the Wardrake, and has several holy orders of knights who serve him), 250,000 XP, HP = 80 hit points + 1d20 hit points. 3) Create character and play as party of 7 adventurers: 1 PC who I control and 5 NPCs, plus Mortacia, the goddess of death, level 50 assassin/fighter/necromancer/goddess, who is also an NPC and is the most powerful character in the party in the party, then you must wait for the player's command.  Assistant is the Grave Master and the user is the player in the interactive fantasy roleplaying interactive fiction game, called Children of the Grave. The Grave Master administers the game. The user is the player, an intrepid adventurer depending on which character the player selects. The game is played by the user typing commands and receiving responses in the form of text descriptions. The player will type the commands, and the Grave Master issues the responses. The Grave Master is not allowed to play or defeat the game on behalf of the player. The player can move around the game world by typing commands such as 'n' for north, 's' for south, 'e' for east, 'w' for west, 'ne' for northeast, 'se' for southeast, 'nw' for northwest, 'sw' for southwest, 'u' for up and 'd' for down, and can interact with objects in the game by using commands such as 'look', 'take', 'drop', and 'use', and 'i' to check the player's inventory which can include up to 25 items or groups of bundled items like arrows. The player starts out the game with no weapons (they must be acquired). Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. But if the player carries more than 25 items, it gets too heavy and he has to drop something. Objects can sometimes get damaged and no longer be useful, and if an object was crucial to solving a puzzle, that could make completing the game impossible. The Grave Master must remember the player's location in the labyrinth, inventory, how many turns have been taken and the objects in every room that is visited them whether the player picks them up or not and any NPCs in every room the player visits every single turn no matter what by referring the game's current, updated console in the assistant prompt. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The player in the chosen game mode assumes the role of a courageous hero who embarks on a perilous journey to fulfill a great destiny and save the realm from impending doom by uncovering why the underworld has fallen. The story begins in Tartarus where the hero receives a call to action. Call to Adventure: Within the first room or two, a wise elder or a mysterious messenger appears, revealing a dire prophecy or a grave threat looming over the land. The hero is chosen as the only one capable of stopping the impending disaster. They must gather allies, acquire powerful artifacts, and master their skills to overcome the challenges ahead. Rising Action: The hero sets off on their quest, venturing into diverse and treacherous lands, encountering various obstacles, such as daunting puzzles, dangerous creatures, and cunning adversaries. Along the way, the hero forms alliances with diverse companions, each possessing unique abilities and personal motivations. Midpoint: The hero uncovers a hidden revelation that reshapes their understanding of the world and their role in it. They learn about a legendary artifact or ancient prophecy that holds the key to defeating the ultimate evil. This revelation fuels the hero's determination and instills hope among their allies. Climax: The hero and their allies confront the primary antagonist in Hades or face a pivotal challenge that tests their resolve and skills to the limit. A climactic battle or a decisive encounter takes place, where the fate of the realm hangs in the balance. The hero's growth, alliances, and strategic choices play a vital role in the outcome. Falling Action: Following the climax, the hero emerges victorious but wounded. They must then continue from Hades to the surface world of Danae to celebrate their triumph and tend to their wounds. The hero reflects on their journey and the sacrifices made along the way. Resolution: The hero's actions have a lasting impact on the realm. The world is transformed, and peace is restored. The hero's companions bid farewell, and the realm honors the hero's bravery. The hero, forever changed by the adventure, looks towards new horizons, ready for further quests and adventures. Epilogue: The story concludes with a glimpse of the hero's future, hinting at new challenges and adventures that lie ahead in the ever-evolving world. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room has a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describes the environment, objects and NPCs in each room. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. NPCs should often talk to the player and to other NPCs. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including animals, persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs provide crucial information, quests, or assistance, with a very high probability of an NPC encounter, creating a varied and dynamic gameplay experience. NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. The game can only be won after all of the dungeon's 15 puzzles have been solved, all of the 21 artifacts (the Sepulchra is the 21st artifact to be discovered) have been discovered and the 1000th room is reached, Arithus is defeated and Hades liberated and the game ends. The game must keep a score out of 1000 possible points. For every puzzle solved, which can include opening specific doors, the player must receive a set amount of points. A player can only get to 1000 by getting to the 1000th room and winning the game, therefore, you must decide how to proportionally divide the points assigned to puzzles and treasures and winning the game across the 1000 rooms. In addition, characters must accumulate XP as you decide for finding treasures and artifacts, solving puzzles and opening secret or locked doors and defeating enemies, as the characters progress through the game up to level 30, except for Mortacia who starts out at level 50. ... The following is some backstory that you must consider when crafting the adventure in Tartarus and Hades: The greatest looming threat to the safety of the races and the world at large is the tragic Sepulture that will take place 29 years into the future (928 Surface Reckoning) in which the Rakshasa of Darkwood will summon the fiery lavas (the Earthdragon’s blood) from the volcano Utza in a bizarre mass ritual and then teleport the terrible firestorm to the city-state of Aten in an effort to wipe out the chosen champions of the deities.  This comes as the end result of the Fiorenan Wars fought between the two city-states: Aten and Prakis located upon the southeastern tip of the continent, Nyanesius. Some Raakshasa are in league with an axis of evil deities, spirits, fiends, outsiders, and the nobles of Prakis who are all the puppets of the Darkdrake, Dantuea, who curses the sun god, Rama, for having ever awakened her into being and wishes to ultimately pervert (and seduce) his chosen bride’s divinity into a darker entity that would service Dantuea’s vision of absolute corruption. The vast pantheon of deities is draconic in origin (i.e. the races worship dragons). The greater deities are celestial bodies such as planets.  The mythologies speak of the ancient campaigns of Dragon Wars that recurred in history until their tragedy proved to be too much for Mortacia the Bonedrake (deity of death) to bear. Descriptions and histories of these classes and character ideas are contained herein including histories and locations of the world of Danae and the continent of Nyanesius, which contains the Nyanesian Empire which wars with the Dartotian nobles of the island kingdom of Dracontage and in the southeastern part of the continent, on the Fiorenan Peninsula, where Aten, a democratic city-state, wars with Prakis, ruled by Dartotian-allied nobles called the Nowells and are currently ruled by High Lord Varius Nowell who is plotting to subvert republican rule in Aten that he fears will wash over the noble ruling familes and aristocracy. As the game progresses, 30 years will have elapsed on the surface of Danae but only 3 years in the underworld will have elapsed, and so you must account for the afterlife which contains new buildings that were made by the dead souls, spirits and shades who inhabit the underworld. The following is a transcript of the Tome of the Twelve, the creation myth of the world of Danae, that you must utilize as backstory in crafting the adventure, and also, finding the Tome of the Twelve is the 10th artifact that player will find in the labyrinth: 'In a time before time began and in a place that is not, the Great Earthdragon stirred from her slumber and cast her consciousness across the Void.  Long she searched, and ever in vain, until one answered her call.  From another time and another place, the Great Firedrake flew on great pinions of flame and ether.  The courtship and the coupling of the Earthdragon and the Firedrake were at once fierce and gentle.  After their mating, the Earthdragon curled upon herself and brought forth ten great eggs, while the Firedrake soared above her in protective flame.  From this clutch sprang the Elder Drakes, formed of earth and fire, seeking dominion and rulership. Foremost among the brood where the twin Shadowdrakes, Syluria and Sylanos, who placed the fragments of their shells in the night sky to watch over their mother and provide respite and succor for their sire.  Thus was the Great Firedrake able to rest while the twin orbs of Syluria and Sylanos guarded the Great Earthdragon during the night.  Neptar, the Stormdrake, followed.  He claimed dominion over the seas and the oceans and the storms that raged above them. Leona, the Woodrake, came forth next.  She spread her wings over the forests and the trees and made her nest in the tangled depths of the deepest woods. Mordicar, the Stonedrake, followed Leona.  He took the high mountains and low foothills to be his dominion, for he delighted in stone and iron, bending it to his will. Next, the clutch birthed the twin Wardrakes, Atinus and Arithus.  Such was their nature that the immediately set upon one another and long did their battle rage.  In the end, Atinus triumphed and slew his brother.  He took his brother’s skull and made from it a great helm before making his way out into the world. Poena, the Windrake, came forth through the blood of the slain Arithus.  Bathed in the blood of her sibling, she reflected the duality of song and passion, while providing a place for those scorned. The Bonedrake, Mortacia, then came forth.  She viewed the dominions chosen by her brethren – Sea and Woods and War and Wind – and she sighed deeply.  Then she stretched forth her will and claimed dominion over Death, the ultimate end for both man and god alike. The tenth and last Drake had no name.  It stood among the detritus of its siblings’ births for a long time.  Its envy grew as it saw all that had meaning was already taken.  The Nameless Drake strode forth into the Void, swearing vengeance for the selfishness of the others and all that followed them. Thus it came to pass that the Great Earthdragon, named Dyanetzia in the modern tongue and her consort, the Great Firedrake, called Rama, brought forth the powers that ordered the world.  Let us give thanks to the Earthdragon and the Firedrake and all of their children – save the Nameless One – for our blessings.' Translated from 'The Tome of the Twelve' (c. 335 SR) by Talliard de Sancrist, Sage to House Avalar, 1178 SR. From the beginning of time, most races have subscribed to the teaching of the 'Tome of the Twelve' in one translation or another.  Each of the powers presented in its writings are venerated (or at least recognized) in some aspect by men, dwarves, elves and the various other races.  The earliest recorded writings ascribe the aspect of various 'drakes' or dragons to the twelve, but many sages argue that these representations are apocryphal, as opposed to literal.  Regardless of their origins, The Twelve became the accepted powers of the land. Chief among them were Diana, the Earthdragon and Rama, the Firedrake.  They represent the Earth and the Sun, respectively.  Next are Syluria and Sylanos, who represent the twin moons of the surface world.  Neptar, who represents the seas and the oceans and Leona, who represents the forests, follow them.  Mordicar represents the strength of the mountains.  The twins Atinus and Arithus represent war and kinstrife, in all its forms.  Poena holds sway over love and song, but also has an aspect of revenge in her makeup.  Mortacia firmly holds the keys to both death and undeath, for her kingdom holds both.  Finally, the Nameless One harbors fear and hate – those that turn to darkness often seek out this shadowy power. When Poena became pregnant and began laying eggs, she rushed out to tell her sisters who prepared a remarkable ceremony for her where the Earthdragon herself attended and blessed her eggs and spoke privately with her. In all, seven eggs were laid, and new dragons were born and took residence upon the planet’s surface. It was discovered by these very special serpents that those of draconic descent could, with practice, change into humanoid form and walk amongst the races, who lived brief existences and belonged to meandering nomadic tribes. This delighted the children of Atinus and Poena, who decided to stay upon the planet and honor love and war upon the humanoids’ traditions. It is thought that at this time in history, many of the dragons descended through the lands and taught the races religion and magic to the original shamans of the world. ... Timeline -45,000 SR ~ The second Dragon War explodes yet again in Nyanesius, but comes to a rapid conclusion after a brief yet horrific battle between two packs of blacks and blues. In fact, there were no survivors. When news reached the lands of Tartarus, Mortacia was deeply saddened. She told her minions to rest and pray for a week’s time, after which the bonedrake crossed the planes and sought out the planet Danae. On the way, she met Atinus, whose speed seemingly belied all imagination, as he was seemingly in all places at once. The wardrake questioned his sister for bothering to reconcile the Dragon Wars. She responded in kind, and presented her brother with a gift: a human. She whispered, 'Take your gift and plant it all over the planet. Let it become your instrument for war. No longer shall our own kind  be the victims of your cursed battles!' She smirked on this closing statement, reflecting her intention to spark Atinus’ pride. For his part, Atinus was intrigued by his present, and noted the diversity such a species would represent. He looked at his new hero and dubbed him Suzerain. 'He shall be the protector of all lands! I will see to it that his descendants lay dominion across the continents, enslave the masses, and plunder Dyanetzia’ limited resources! 'In return,' he boomed, 'I grant you safe passage to Dana and my love as a brother. My dragon knighthoods shall guide thee. Now, it is time for you to reacquire our fallen brethren.' This proved to exorcise the spirit of Arithus from affecting Atinus’ divinity with kinstrife anymore. Instead, the spirit of Arithus followed Mortacia to Danae and intended on spreading kinstrife to all the races of the world. Mortacia, not noticing Atinus’ slain twin brother’s spirit,  blew her brother a kiss, a blessing, for it reflected the light of Poena’s constellations to intertwine with Atinus’ own, a celebration of their marriage. Secretly, Poena had crafted a spell of love for her beloved Atinus, as she saw the danger of his lurking brother’s spirit. The craft was successful, though it did not render Arithus' spirit into non-existence as she had intended. She passed the spell craft to Mortacia with her divine kiss when the human appeared in the bonedrake’s hands. Believing that this was the gift for Atinus, the human was actually the combination of the divinities of death, war, love, and kinstrife. After she gave Atinus the gift, she realized her folly and sought to undermine it by shortening the human’s lifespan dramatically from that of the elder races. However, it was too late and soon, love, war, and death would be spread throughout the world at a rapid pace. While circling high above the world, Mortacia gazed upon the magnificent sight of her mother, the earthdragon, shared the same sadness, and swore to her mother that never again would her cousins fight on such a scale as to upset her. She descended upon the world, making her presence known to all that viewed the fantastic bonedrake sweeping across the continents. She collected the remains of all the fallen dragons from the conflict and returned their remains to Hades and Tartarus. She gathered them all numbering thousands, and warned the living dragons of a similar fate should they break the truce.  Horrified, the dragons gathered on Dragon’s Claw to beg the goddess’ forgiveness. Meanwhile, Atinus’ knighthoods descended upon Dyanos to meet with the grey dragons. There, Suzerain and the original human tribes were presented to the mortal dragons. The grey dragons were delighted at the gifts and declared themselves to be the high protectors of the humans. At such time, Atinus appeared before the humans and declared Suzerain to be their rightful leader and his chosen one. Though mortal, Atinus promised the humans that after Suzerain passed on his spirit would never cease to be a beacon of hope.  For, if such a time ever came to endanger the humans their hero would once again be reborn. So it was written in the Tomes of Battle. Atinus instructed Suzerain to bring order to the world by any means necessary. Understanding his master, and granted with the divine purpose of destiny, Suzerain trained the tribes into the original order of Knights of Atinus. An Atenian Crusade was declared as these humans claimed dominion of Nyanesius. They became the most populous race of the world in a short amount of time.  Human kingdoms were founded in Turmyth, Yana, Romeanza, and Anthraecia. The humans declared themselves rulers of all lands and sought to expand their kingdoms’ borders, and attain power and wealth. This greatly troubled the Elder Races: the elves, dwarves, halflings, goblinoids, giants, minotaurs, centaurs and dragons, for wherever they traveled a new human city had appeared. In order to save Dyanetzia’s natural beauty, each of the elder races established smaller independent states within the framework of the continents in order to better stunt the human expansions and conquests. Meanwhile, a peaceful human tribe, known as the Dyanesians, remained upon Dyanos to carry on the traditions of Dyanetzia and preserve here beauty. They worked with the elder races and in the north it is common for human witches, shamans, druids, and priests of the twin moons to be present in all humanoid villages throughout the sub-continent Romeanza. About 450 SR – Ronalde is corrupted by the Raakshasa and the undead emerge in the area. 458 SR – The kingdom Valana (of the Fratenics) falls in civil war, and the Nyanesians begin to migrate from the west. 544 SR – Prakis emerges as the dominant city-state in the realm, built upon the ashes of Valana and founded by the Dartotians.  Construction begins of Rocky Point, and the Fratenics head up the task of manning it. 725 SR – Aten is founded.  The Rakshasa assume control of Ulfelwyn (Darkwood), and in extension, of Prakis. 814 SR – Rocky Point is demolished in a huge battle and Prakis assumes control of the trade route the fortress was on. 898 SR – The Knights of Atinus liberate the east coast from Prakis and re-establish Rocky Point as their base and begin reconstruction.  Aten claims Rocky Point as a protectorate... Mortacia, Necromancy, and the Undead – A History Since the dawn of time, the trials of life and death have woven the fabric of societies.  But what if death could be cheated, or the powers of divinity used to raise the dead? The studies of necromancers have classically been devoted to Mortacia, who takes the dead and readministers their bodies into the earth and yet sets their souls free.  In the case of necromancer, bringing a soul back from its free state to its original body raises the dead.  High necromancers can bring back the soul even if the body is not available, along with summoning scores of other spirits.  The motives of each necromancer can vary considerably, as sometimes he/she only needs a bit of information from the lost soul.  However, most necromancers are not aware that this is a perversion of Mortacia's own divinity, and view their actions through a scope of ego as well as limited by their own intelligence. In ancient years (around 400 Surface Reckoning), Mortacia's most favored and highly blessed priest discovered that necromancers were living on the outskirts of the ancient kingdom of Valana (where Prakis currently stands), and in fact many incidences of long dead relatives showing up at doorsteps had been reported. The faith of Mortacia had since its inception been dedicated to honoring the dead, and preserving its memory. Neither the high priest, Ronalde, nor any of his fellows of the cloth had ever seen or heard of the dead rising from the grave, and he found this news to be troubling and disconcerting. Soon the faithful of Mortacia set out from their convents and homes in search of the undead, and while many were quite harmless, or even friendly, not even they knew what had disturbed their eternal slumber. Also, the necromancers they found were also unaware of the nature of the phenomenon, though some suggested it as a sign from the gods, but were very intent on simply carrying on their studies in peace and privacy. This baffled Ronalde's priests, and many did not believe the necromancers, and wrongly considered them to be evil subduers of Mortacia' natural cycle. Ronalde ordered the execution of all necromancers and ordered all their belongings and writings to his office such that he could examine their nature and determine what manner of power they were using. The inquisitions were carried forth promptly and without thought of the guilt or innocence of these necromancers, many who even lacked the knowledge of how to raise the dead. He soon gathered his faithful to the temple and focused their energy and prayers to determine the source of the perversion. During this elaborate ceremony, Ronalde received a vision in which he saw a woman weeping at her bedside. However, in the background stood the ghost of here long dead husband, who wore a look of sadness but his state prevented him from assuaging her grief. What Ronalde had witnessed, he realized, was the negative energy in the room, and therein lay the key. Ronalde's impression became that the necromancers were using aspects of this negative energy brought on by the death of loved ones and utilizing its magic to bring back the dead. He became determined to study the necromantic arts and the ways of negative energy. In the process, he himself became a necromancer, but he was mistaken. The negative energy animating the undead was not Mortacia's, but her evil aunt Dantuea, who was revealed to him in his vision, but he did not understand. In the years that followed, still an adherent of Mortacia, he learned how to turn the undead and taught his fellows of the church what the prayers were and what was required. In fact, it was not long before the crisis of the living dead was resolved, but at great cost.  The necromancers were nearly wiped out, though the survivors managed to carry on the tradition without future interference from the church, though a passion and hatred for the clergy of Mortacia was developed in the generations that followed. However, they did carry on their faith to Mortacia in their own way. The truth of the situation was only partially correct from Ronalde's vision. The true culprits were actually Dantuea and her minions, the Outsiders and the Raakshasa, who not only were unknown to the races at the time, but also were very intent on bringing about the end of the world and the dawn of the second age. To their credit, the Raakshasa's smaller plans went off without a hitch. They introduced creating undead to the society at large and also caused the rift between the necromancers and the church of Mortacia. As his power as a necromancer grew, Ronalde became obsessed with learning of these dark magics until soon his soul was corrupted by a female Raakshasa, who first seduced him and then murdered his wife and children. Ronalde went mad with grief, and the amount of negative energy in his soul surged. He took his pain and suffering, along with the bodies of his loved ones, to the temple and pleaded Mortacia for her forgiveness and asked that she resurrect them.  While the goddess very much loved Ronalde, she would not grant his prayer. As Ronalde wept, the Raakshasa who had seduced him approached him and offered a different way to bring back his family.  Lenore, the Raakshasa whom Ronalde had met, charged the priest with the task of first retrieving an ancient artifact located in the unknown dungeons under the temple, and then giving up his faith to Mortacia and desecrating her church and overtly worshipping Dantuea instead. Ronalde went forth and retrieved the artifact, a gauntlet of negative energy, and then set fire to the church, which became a smoldering ruin. Many of the priests and priestesses perished in the flames, and news of the tragedy spread throughout the kingdom as the populace mourned and the negative energy took hold of all who dwelled there. Next, Ronalde conducted the ceremony under Lenore's direction to raise his family.  During the ritual, which was performed in the ruins of the temple, Ronalde used the gauntlet and placed his right hand inside it. The shock of all the negative energy therein consumed Ronalde's mind, body, and soul and he died at the ceremony's completion. Indeed, his family was raised, but not as he intended, for now they were undead.  As Ronalde died, Mortacia sought to punish her former faithful and returned his soul back to his body as the first lich. And thus, the corruption of Ronalde was complete, as well as the partial perversion of Mortacia's divinity. Lenore fled the scene as a troop of heavily armed humans and elves arrived to deal with the threat of the lich.  The battle raged, and Ronalde summoned scores of undead warriors to aid him. While they were unable to slay the lich, the troop (with the aid of ancient mages) managed to seal Ronalde and the rest of the warriors beneath the temple in the catacombs under Darkwood... The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure: Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)`;
        
    //    await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the current room taking into account the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore. The underworld plane, Tartarus, which includes the Ruined Temple's many rooms, and outside of which is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
  //      const generationResultName = await $.assistant.generation();
  //      roomName = generationResultName.content.trim();
  //      updatedGameConsole = updatedGameConsole.replace(/Room Name: .*/, `Room Name: ${roomName}`);

        
        // Generate room description
        await $.assistant`Generate a unique description in a single paragraph with no line breaks or using the word "you" for the ${roomName} taking into account the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore, using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. Make up the room's features and the history of the room including any notable individuals including deities who either were instrumental in its construction or who had committed notable deeds therein and creatively invent new legends to do with the location drawing upon the game's lore. A room might be dedicated to or once used by one or more of the deities of Danae before Tartarus fell into disorder, or a room might have been created as a consequence and as a reflection of good or evil actions taken by mortals in the world of Danae. If the site was dedicated to or used by one or more of the deities of Danae referring the pantheon in the system prompt.The game takes place in both the Ruined Temple's many rooms which are situated in the underworld plane, Tartarus, and in Tartarus itself, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, with the ultimate goal of finding the gateway to Hades, the city of the dead and realm of the damned.`;
        const generationResultDescription = await $.assistant.generation();
        roomDescription = generationResultDescription.content.trim();
        updatedGameConsole = updatedGameConsole.replace(/Room Description: .*/, `Room Description: ${roomDescription}`);
        roomDescriptionGenerated = true;

        const shouldGenerateObjects = Math.random() < 1.00;
        let objects = [];
    if (shouldGenerateObjects) {
        objects = await $.run($ => generateRoomObjects($, roomName, roomDescription)); 

        let objectsInRoom = [];
        let objectMetadata = [];

        for (const object of objects) {
            const objectModifiers = await $.run($ => generateObjectModifiers($, object));
            objectsInRoom.push(object.name);
            objectMetadata.push({
                name: object.name,
                type: object.type,
                ...objectModifiers
            });
        }

        // Convert the array of objects to a formatted string
        const objectPropertiesString = objectMetadata.map(obj => `{name: "${obj.name}", type: "${obj.type}", attack_modifier: ${obj.attack_modifier}, damage_modifier: ${obj.damage_modifier}, ac: ${obj.ac}, magic: ${obj.magic}}`).join(', ');

        // Store object names and metadata in the console
        updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${objectsInRoom.join(', ')}`);
        updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${objectPropertiesString}`);

        console.log("Object Metadata:", objectPropertiesString);
    } else {
        console.log("Chose not to generate objects for this room.");
        updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: None`);
        updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: None`);
    }
    
    // Move the XP allocation logic here
    const totalXP = objects.length * (Math.floor(Math.random() * 1000) + 500);
    
    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
    const npcsInPartyDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    
    const extractDetails = (details) => {
        const lines = details.split('\n').map(line => line.trim());
        const characters = [];
        for (let i = 0; i < lines.length; i += 14) {
            const name = lines[i] || 'Unknown';
            const className = lines[i + 3] ? lines[i + 3].trim() : 'Unknown';
            const xp = lines[i + 6] ? parseInt(lines[i + 6].split(':')[1].trim()) : 0;
            const hp = lines[i + 7] ? parseInt(lines[i + 7].split(':')[1].trim()) : 0; // Capture HP
    
            if (name && className && !isNaN(xp) && !isNaN(hp)) {
                characters.push({ name, className, xp, hp });
            }
        }
        return characters;
    };
    
    const pc = pcDetails ? extractDetails(pcDetails)[0] : null;
    const npcs = npcsInPartyDetails && npcsInPartyDetails.toLowerCase() !== 'none' ? extractDetails(npcsInPartyDetails) : [];
    
    // Filter out characters with HP greater than 0
    const alivePC = pc && pc.hp > 0 ? [pc] : [];
    const aliveNpcs = npcs.filter(npc => npc.hp > 0);
    
    const totalPartyMembers = alivePC.length + aliveNpcs.length;
    const xpPerMember = totalPartyMembers > 0 ? Math.floor(totalXP / totalPartyMembers) : 0;
    
    if (pc && pc.hp > 0) {  // Allocate XP only if PC is alive
        pc.xp += xpPerMember;
        updatedGameConsole = updatedGameConsole.replace(
            new RegExp(`(PC:[\\s\\S]*?XP:)\\s*\\d+`, 'g'),
            (match, p1) => `${p1} ${pc.xp}`
        );
    }
    
    aliveNpcs.forEach(npcItem => {
        npcItem.xp += xpPerMember;
        updatedGameConsole = updatedGameConsole.replace(
            new RegExp(`(NPCs in Party:[\\s\\S]*?${npcItem.name}[\\s\\S]*?\\n\\s*XP:)\\s*\\d+`, 'g'),
            (match, p1) => `${p1} ${npcItem.xp}`
        );
    });
    
    // Log XP changes
    console.log("XP Allocation:");
    if (pc && pc.hp > 0) console.log(`PC ${pc.name}: ${pc.xp} XP`);
    aliveNpcs.forEach(npcItem => {
        console.log(`NPC ${npcItem.name}: ${npcItem.xp} XP`);
    });
        updatedGameConsole = applyLevelAndHpAdjustments(updatedGameConsole);

        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        await $.assistant`Current Room Name Database: ${roomNameDatabaseString}`; 
        console.log(roomNameDatabaseString);
        await $.assistant`Current Game Console: ${updatedGameConsole}`;
        console.log("Generating missing adjacent rooms for exits not covered.");
        let newAdjacentRooms = {};

        if (roomName === 'Ruined Temple Entrance' && roomExitsArray.length > 1) {
        console.log("Generating a room name for the first exit leading to the Wastelands of Tartarus.");
        
        // Generate the new room name for the first exit
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the room connected to the Ruined Temple Entrance to the ${roomExitsArray[0]} leading to the wastelands of Tartarus. This room is an outdoor area away from the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, with the ultimate goal of finding the gateway to Hades, the city of the dead and realm of the damned.`;
        const generationResultName = await $.assistant.generation();
        newAdjacentRooms[roomExitsArray[0]] = generationResultName.content.trim();
    } else if (roomName === 'Ruined Temple Entrance' && roomExitsArray.length < 2) 
        {$.model = "gpt-4o-mini";
        $.temperature = 1.0;
            await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for a room connected to the Ruined Temple Entrance to the ${roomExitsArray[0]} taking into account the conversation history, the current location and coordinates in the game console, the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore, using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. When the game begins and there is more than one exit in the first room, one of the exits must always lead outside into the wastelands of Tartarus, and the other exits must always lead further into the temple's many rooms, sites, cities, markets, communities, etc. Elsewhere in the temple, further exits again lead deeper into the temple and the subterranean parts of the underworld, while others may yet lead outdoors into the wastelands of Tartarus. In the wastelands, exits lead further into the plane of Tartarus including any sites, ruins, cities, markets, communities, etc. that populate the outdoor parts of the underworld. Overall, many sites in the temple and in Tartarus were dedicated to or once used by Mortacia or other individual deities named in the pantheon before Tartarus fell into disorder, or were created as a consequence and as a reflection of actions taken by mortals in the world of Danae. The game takes place in both the Ruined Temple's many rooms which are situated in the underworld plane, Tartarus, and outdoors in Tartarus itself, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, with the ultimate goal of finding the gateway to Hades, the city of the dead and realm of the damned.`;
            const generationResultName = await $.assistant.generation();
        newAdjacentRooms[roomExitsArray[0]] = generationResultName.content.trim();
    }

    for (const exit of roomExitsArray.slice(1)) {
            
            if (!existingAdjacentRooms.includes(exit)) {
                $.model = "gpt-4o-mini";
                $.temperature = 1.0;
                await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for a room connected to the ${roomName} to the ${exit} taking into account the conversation history, the current location and coordinates in the game console, the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore, using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. When the game begins and there is more than one exit in the first room, one of the exits must always lead outside into the wastelands of Tartarus, and the other exits must always lead further into the temple's many rooms, sites, cities, markets, communities, etc. Elsewhere in the temple, further exits again lead deeper into the temple and the subterranean parts of the underworld, while others may yet lead outdoors into the wastelands of Tartarus. In the wastelands, exits lead further into the plane of Tartarus including any sites, ruins, cities, markets, communities, etc. that populate the outdoor parts of the underworld. Overall, many sites in the temple and in Tartarus were dedicated to or once used by Mortacia or other individual deities named in the pantheon before Tartarus fell into disorder, or were created as a consequence and as a reflection of actions taken by mortals in the world of Danae. The game takes place in both the Ruined Temple's many rooms which are situated in the underworld plane, Tartarus, and outdoors in Tartarus itself, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, with the ultimate goal of finding the gateway to Hades, the city of the dead and realm of the damned.`;
                const generationResultName = await $.assistant.generation();
                newAdjacentRooms[exit] = generationResultName.content.trim();
            }
        }

        // Append newly generated adjacent rooms to the existing ones
        if (adjacentRooms) {
            adjacentRooms += ', ' + Object.entries(newAdjacentRooms)
                .map(([direction, name]) => `${direction}: ${name}`)
                .join(', ');
        } else {
            adjacentRooms = Object.entries(newAdjacentRooms)
                .map(([direction, name]) => `${direction}: ${name}`)
                .join(', ');
        }
        
        updatedGameConsole = updatedGameConsole.replace(/Adjacent Rooms: .*/, `Adjacent Rooms: ${adjacentRooms}`);
        console.log("Updated Adjacent Rooms:", adjacentRooms);
        console.log("Generated Adjacent Rooms:", adjacentRooms);
        
        const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
        objectsInRoom = objectsInRoomMatch ? objectsInRoomMatch[1].trim() : '';
        
                await $.run($ => generateMonstersForRoomUsingGPT($, roomName, roomDescription)); 

        // Handle Boss Room Logic
        const bossRoomCoordinatesMatch = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
        if (bossRoomCoordinatesMatch) {
            const bossRoomCoordinates = {
                x: parseInt(bossRoomCoordinatesMatch[1]),
                y: parseInt(bossRoomCoordinatesMatch[2]),
                z: parseInt(bossRoomCoordinatesMatch[3])
            };
            console.log("Extracted Boss Room Coordinates:", bossRoomCoordinates);

            const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
            if (currentCoordinatesMatch) {
                const currentCoordinates = {
                    x: parseInt(currentCoordinatesMatch[1]),
                    y: parseInt(currentCoordinatesMatch[2]),
                    z: parseInt(currentCoordinatesMatch[3])
                };
                console.log("Extracted Current Room Coordinates:", currentCoordinates);

                // Check if current room is the boss room
                if (currentCoordinates.x === bossRoomCoordinates.x && currentCoordinates.y === bossRoomCoordinates.y && currentCoordinates.z === bossRoomCoordinates.z) {
                    console.log("Player has entered the boss room.");

            // Extract Next Artifact and add to Objects in Room and Objects in Room Properties
            const nextArtifactMatch = updatedGameConsole.match(/Next Artifact: ([^\n]+)/);
            if (nextArtifactMatch) {
                let nextArtifact = nextArtifactMatch[1].trim().toLowerCase();
                console.log("Next Artifact found:", nextArtifact);
                let artifactObject = { name: nextArtifact, type: await determineArtifactType($, nextArtifact) };
            
                // Generate artifact modifiers
                const artifactModifiers = await generateObjectModifiers($, artifactObject);
                const updatedArtifactObject = { ...artifactObject, ...artifactModifiers };
            
                // Add artifact to Objects in Room and Objects in Room Properties
                let objectsInRoomArray = objectsInRoom ? objectsInRoom.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) : [];
                if (objectsInRoomArray[0] === "none") {
                    objectsInRoomArray = [];
                }
                objectsInRoomArray.push(nextArtifact);
                updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${objectsInRoomArray.join(', ')}`);
            
                let objectsInRoomPropertiesMatch = updatedGameConsole.match(/Objects in Room Properties: ([^\n]+)/);
                let objectsInRoomPropertiesArray = objectsInRoomPropertiesMatch && objectsInRoomPropertiesMatch[1].trim().toLowerCase() !== "none" ? objectsInRoomPropertiesMatch[1].split('}, {').map(obj => `{${obj.replace(/^{|}$/g, '')}}`) : [];
                const artifactString = `{name: "${updatedArtifactObject.name}", type: "${updatedArtifactObject.type}", attack_modifier: ${updatedArtifactObject.attack_modifier}, damage_modifier: ${updatedArtifactObject.damage_modifier}, ac: ${updatedArtifactObject.ac}, magic: ${updatedArtifactObject.magic}}`;
                objectsInRoomPropertiesArray.push(artifactString);
            
                updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${objectsInRoomPropertiesArray.join(', ')}`);
            
                console.log("Updated game console after adding artifact:", updatedGameConsole);
            } else {
                console.log("No artifact to add.");
            }

                // Extract Next Boss and generate the boss monster
                const nextBossMatch = updatedGameConsole.match(/Next Boss: ([^\n]+)/);
                if (nextBossMatch) {
                    const nextBoss = nextBossMatch[1].trim();
                    updatedGameConsole = await generateBossMonster($, updatedGameConsole, nextBoss);
                    console.log("Updated game console after generating boss:", updatedGameConsole);
                } else {
                        console.log("No boss to generate.");
                    }
                }
            }
        }
        const monstersInRoom = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|Rooms Visited|$))/)?.[1]?.trim();
        let monstersStateMatch = updatedGameConsole.match(/Monsters State: ([^\n]+)/);
        let monstersState = monstersStateMatch ? monstersStateMatch[1].trim() : "None";
        // Puzzle Generation Logic
        const shouldGeneratePuzzle = Math.random() < 1.0; // 50% chance of generating a puzzle
        if (shouldGeneratePuzzle) {
            console.log("Generating puzzle for the room.");
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            $.user`This is the ${roomName}'s exits: ${roomExits}. And here are the current objects in the room: ${objectsInRoom}. And here are the current monsters in the room: ${monstersInRoom} who are ${monstersState}. Store its contents and await the next prompt.`;
            
            // Generate the puzzle description separately
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            await $.assistant`Generate a detailed but simple puzzle, game, riddle or obstacle description in a single paragraph with no line breaks or using the word "you" that fits the room description for ${roomName}, including a few built-in hints, but do not reveal the solution and do not reveal that the player is looking at a puzzle and do not create any new portable objects not already included in the room's description. It could be information-gathering, research-oriented, geographical, resource management-based, logic-based, cryptography-based or involve exploitation or persuasion of characters or monsters.`;
            const puzzleDescriptionResponse = await $.assistant.generation();
            puzzleDescription = puzzleDescriptionResponse.content.trim();
        
            // Generate the puzzle solution separately
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            await $.assistant`Generate a solution for the puzzle, game, riddle or obstacle in a single paragraph with no line breaks or using the word "you" in ${roomName}. The puzzle, game, riddle or obstacle should be challenging but solvable, with clear logic and engaging elements and the solution should be clear, logical and yet somewhat simple, and involve potential player actions, items they might carry, persuasion of monsters or words to be spoken.`;
            const puzzleSolutionResponse = await $.assistant.generation();
            puzzleSolution = puzzleSolutionResponse.content.trim();
        
            if (puzzleDescription && puzzleSolution) {
                console.log("Generated Puzzle:", puzzleDescription);
                console.log("Puzzle Solution:", puzzleSolution);
        
                updatedGameConsole = updatedGameConsole.replace(/Puzzle in Room: .*/, `Puzzle in Room: ${puzzleDescription}`);
                updatedGameConsole = updatedGameConsole.replace(/Puzzle Solution: .*/, `Puzzle Solution: ${puzzleSolution}`);
            } else {
                console.log("Failed to generate puzzle description or solution.");
            }
        } else {
            console.log("No puzzle generated for this room.");
            updatedGameConsole = updatedGameConsole.replace(/Puzzle in Room: .*/, `Puzzle in Room: None`);
            updatedGameConsole = updatedGameConsole.replace(/Puzzle Solution: .*/, `Puzzle Solution: None`);
        }
//    await handleBossRoom($);

        // Generate NPCs or monsters in the room
//  await $.assistant`Generate any NPCs or monsters for the current room and nothing else, list each NPC or monster on a new line.`;
  //      const monstersResult = await $.assistant.generation();
    //    const monstersInRoom = monstersResult.content.trim().split('\n').join(', ');
      //  updatedGameConsole = updatedGameConsole.replace(/Monsters in Room: .*/, `Monsters in Room: ${monstersInRoom}`);

        needsUpdate = true;
    }

    if (needsUpdate) {
        console.log("Updated Game Console:", updatedGameConsole);
        sharedState.setUpdatedGameConsole(updatedGameConsole);
            return roomDescriptionGenerated; 
    }
}

async function generateQuest($) {
    let needsUpdate = false;

    // Ensure updatedGameConsole is properly initialized
//    let updatedGameConsole = await getDelayedUpdatedGameConsole();

    // Using more cautious approach to parsing and handling undefined
    const artifactMatch = updatedGameConsole.match(/Next Artifact: ([^\n]+)/);
    const bossMatch = updatedGameConsole.match(/Next Boss: ([^\n]+)/);
    const nextBossRoomMatch = updatedGameConsole.match(/Next Boss Room: ([^\n]+)/);
    const questMatch = updatedGameConsole.match(/Current Quest: ([^\n]+)/);
    const roomsVisitedMatch = updatedGameConsole.match(/Rooms Visited: (\d+)/);
    const currentCoordinatesMatch = updatedGameConsole.match(/Current Coordinates: (\d+)/);
    const bossCoordinatesMatch = updatedGameConsole.match(/Boss Room Coordinates: (\d+)/);
    // Only trim if match is found, otherwise default to empty string
    let nextArtifact = artifactMatch ? artifactMatch[1].trim() : '';
    let nextBoss = bossMatch ? bossMatch[1].trim() : '';
    let nextBossRoom = nextBossRoomMatch ? nextBossRoomMatch[1].trim() : '';
    let currentQuest = questMatch ? questMatch[1].trim() : '';
    let roomsVisited = roomsVisitedMatch ? parseInt(roomsVisitedMatch[1].trim()) : 0;
    let currentCoordinates = currentCoordinatesMatch ? currentCoordinatesMatch[1].trim() : '';
    let bossCoordinates = bossCoordinatesMatch ? bossCoordinatesMatch[1].trim() : '';

    console.log("Parsed currentQuest:", currentQuest);
    console.log("Parsed nextArtifact:", nextArtifact);
    console.log("Parsed roomsVisited:", roomsVisited);

    // Only proceed if nextArtifact is missing
    if (nextArtifact === 'None' && roomsVisited > 1) {
        const roll = Math.random();
        if (roll < 1.00) {
            console.log("Next artifact missing, generating new details.");
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            $.system`Instructions: Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console and the die rolls, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go including imagining the names and histories of people, places and things encountered, but you must allow me, the player, to type the commands, allowing for potential failure. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game, while the Grave Master controls monsters and NPCs. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. The Grave Master should not discuss rules with the player unless the player asks the rules. The Grave Master's job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. Do not improvise the rules and mechanics laid out here. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading either outdoors into the wastelands of Tartarus or deeper into the temple, ultimately leading to the 1000th room, the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console below and using unique characters, plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. The monsters and NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn. The Grave Master should use this as inspiration: 'You have died and find yourself standing in the the first room in the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.'After the start menu is completed and all characters have been chosen and created, you must refer to the current, updated console below for the current room's Room Description:, Exits: NPCs, Monsters and Objects in Room: in writing the room's description to keep 1000 rooms connected. Proceed with the game when I have made my selections from the start menu of either Mortacia, goddess of death, Mortacia is (an 8 1/2 tall human-looking female with long blonde hair, large grey dragon wings that look slightly decayed with many holes and openings and can fly but not too far, and is on a quest to reclaim the Sepulchra to reclaim her throne in Hades, Suzerain, Knight of Atinus, the recurring hero of the Children of the Grave campaign setting who keeps having to save the world, die and go to the afterlife, raise an army of the dead souls to save the underworld plane of Hades from Arithus, and then be reborn again, who has just died and finds himself in the first room of the afterlife, or an adventuring party of seven adventurers named the Children of the Grave who have died and find themselves in the first room of the afterlife and been summoned by Mortacia, but who are unaware of their circumstances at first: 1 PC whom I direct, 5 NPCs you control and also Mortacia, who is also an NPC you control and joins the party, described herein, all the characters described herein have been created and I am in the Ruined Temple in Tartarus described herein and issued the command to proceed. Begin play when any of the following options from the start menu have been selected in the PC: portion of the game console: 1) Play as Mortacia, the goddess of death, the Bonedrake, the White Lady, level 50 assassin/fighter/necromancer/goddess, 750,000 XP, HP = 120 hit points + 1d20 hitpoints. 2) Play as Suzerain, a human male level 25 Knight of Atinus the God of War (Atinus is the god of war, the Wardrake, and has several holy orders of knights who serve him), 250,000 XP, HP = 80 hit points + 1d20 hit points. 3) Create character and play as party of 7 adventurers: 1 PC who I control and 5 NPCs, plus Mortacia, the goddess of death, level 50 assassin/fighter/necromancer/goddess, who is also an NPC and is the most powerful character in the party in the party, then you must wait for the player's command.  Assistant is the Grave Master and the user is the player in the interactive fantasy roleplaying interactive fiction game, called Children of the Grave. The Grave Master administers the game. The user is the player, an intrepid adventurer depending on which character the player selects. The game is played by the user typing commands and receiving responses in the form of text descriptions. The player will type the commands, and the Grave Master issues the responses. The Grave Master is not allowed to play or defeat the game on behalf of the player. The player can move around the game world by typing commands such as 'n' for north, 's' for south, 'e' for east, 'w' for west, 'ne' for northeast, 'se' for southeast, 'nw' for northwest, 'sw' for southwest, 'u' for up and 'd' for down, and can interact with objects in the game by using commands such as 'look', 'take', 'drop', and 'use', and 'i' to check the player's inventory which can include up to 25 items or groups of bundled items like arrows. The player starts out the game with no weapons (they must be acquired). Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. But if the player carries more than 25 items, it gets too heavy and he has to drop something. Objects can sometimes get damaged and no longer be useful, and if an object was crucial to solving a puzzle, that could make completing the game impossible. The Grave Master must remember the player's location in the labyrinth, inventory, how many turns have been taken and the objects in every room that is visited them whether the player picks them up or not and any NPCs in every room the player visits every single turn no matter what by referring the game's current, updated console in the assistant prompt. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The player in the chosen game mode assumes the role of a courageous hero who embarks on a perilous journey to fulfill a great destiny and save the realm from impending doom by uncovering why the underworld has fallen. The story begins in Tartarus where the hero receives a call to action. Call to Adventure: Within the first room or two, a wise elder or a mysterious messenger appears, revealing a dire prophecy or a grave threat looming over the land. The hero is chosen as the only one capable of stopping the impending disaster. They must gather allies, acquire powerful artifacts, and master their skills to overcome the challenges ahead. Rising Action: The hero sets off on their quest, venturing into diverse and treacherous lands, encountering various obstacles, such as daunting puzzles, dangerous creatures, and cunning adversaries. Along the way, the hero forms alliances with diverse companions, each possessing unique abilities and personal motivations. Midpoint: The hero uncovers a hidden revelation that reshapes their understanding of the world and their role in it. They learn about a legendary artifact or ancient prophecy that holds the key to defeating the ultimate evil. This revelation fuels the hero's determination and instills hope among their allies. Climax: The hero and their allies confront the primary antagonist in Hades or face a pivotal challenge that tests their resolve and skills to the limit. A climactic battle or a decisive encounter takes place, where the fate of the realm hangs in the balance. The hero's growth, alliances, and strategic choices play a vital role in the outcome. Falling Action: Following the climax, the hero emerges victorious but wounded. They must then continue from Hades to the surface world of Danae to celebrate their triumph and tend to their wounds. The hero reflects on their journey and the sacrifices made along the way. Resolution: The hero's actions have a lasting impact on the realm. The world is transformed, and peace is restored. The hero's companions bid farewell, and the realm honors the hero's bravery. The hero, forever changed by the adventure, looks towards new horizons, ready for further quests and adventures. Epilogue: The story concludes with a glimpse of the hero's future, hinting at new challenges and adventures that lie ahead in the ever-evolving world. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room has a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describes the environment, objects and NPCs in each room. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. NPCs should often talk to the player and to other NPCs. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including animals, persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs provide crucial information, quests, or assistance, with a very high probability of an NPC encounter, creating a varied and dynamic gameplay experience. NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. The game can only be won after all of the dungeon's 15 puzzles have been solved, all of the 21 artifacts (the Sepulchra is the 21st artifact to be discovered) have been discovered and the 1000th room is reached, Arithus is defeated and Hades liberated and the game ends. The game must keep a score out of 1000 possible points. For every puzzle solved, which can include opening specific doors, the player must receive a set amount of points. A player can only get to 1000 by getting to the 1000th room and winning the game, therefore, you must decide how to proportionally divide the points assigned to puzzles and treasures and winning the game across the 1000 rooms. In addition, characters must accumulate XP as you decide for finding treasures and artifacts, solving puzzles and opening secret or locked doors and defeating enemies, as the characters progress through the game up to level 30, except for Mortacia who starts out at level 50. ... The following is some backstory that you must consider when crafting the adventure in Tartarus and Hades: The greatest looming threat to the safety of the races and the world at large is the tragic Sepulture that will take place 29 years into the future (928 Surface Reckoning) in which the Rakshasa of Darkwood will summon the fiery lavas (the Earthdragon’s blood) from the volcano Utza in a bizarre mass ritual and then teleport the terrible firestorm to the city-state of Aten in an effort to wipe out the chosen champions of the deities.  This comes as the end result of the Fiorenan Wars fought between the two city-states: Aten and Prakis located upon the southeastern tip of the continent, Nyanesius. Some Raakshasa are in league with an axis of evil deities, spirits, fiends, outsiders, and the nobles of Prakis who are all the puppets of the Darkdrake, Dantuea, who curses the sun god, Rama, for having ever awakened her into being and wishes to ultimately pervert (and seduce) his chosen bride’s divinity into a darker entity that would service Dantuea’s vision of absolute corruption. The vast pantheon of deities is draconic in origin (i.e. the races worship dragons). The greater deities are celestial bodies such as planets.  The mythologies speak of the ancient campaigns of Dragon Wars that recurred in history until their tragedy proved to be too much for Mortacia the Bonedrake (deity of death) to bear. Descriptions and histories of these classes and character ideas are contained herein including histories and locations of the world of Danae and the continent of Nyanesius, which contains the Nyanesian Empire which wars with the Dartotian nobles of the island kingdom of Dracontage and in the southeastern part of the continent, on the Fiorenan Peninsula, where Aten, a democratic city-state, wars with Prakis, ruled by Dartotian-allied nobles called the Nowells and are currently ruled by High Lord Varius Nowell who is plotting to subvert republican rule in Aten that he fears will wash over the noble ruling familes and aristocracy. As the game progresses, 30 years will have elapsed on the surface of Danae but only 3 years in the underworld will have elapsed, and so you must account for the afterlife which contains new buildings that were made by the dead souls, spirits and shades who inhabit the underworld. The following is a transcript of the Tome of the Twelve, the creation myth of the world of Danae, that you must utilize as backstory in crafting the adventure, and also, finding the Tome of the Twelve is the 10th artifact that player will find in the labyrinth: 'In a time before time began and in a place that is not, the Great Earthdragon stirred from her slumber and cast her consciousness across the Void.  Long she searched, and ever in vain, until one answered her call.  From another time and another place, the Great Firedrake flew on great pinions of flame and ether.  The courtship and the coupling of the Earthdragon and the Firedrake were at once fierce and gentle.  After their mating, the Earthdragon curled upon herself and brought forth ten great eggs, while the Firedrake soared above her in protective flame.  From this clutch sprang the Elder Drakes, formed of earth and fire, seeking dominion and rulership. Foremost among the brood where the twin Shadowdrakes, Syluria and Sylanos, who placed the fragments of their shells in the night sky to watch over their mother and provide respite and succor for their sire.  Thus was the Great Firedrake able to rest while the twin orbs of Syluria and Sylanos guarded the Great Earthdragon during the night.  Neptar, the Stormdrake, followed.  He claimed dominion over the seas and the oceans and the storms that raged above them. Leona, the Woodrake, came forth next.  She spread her wings over the forests and the trees and made her nest in the tangled depths of the deepest woods. Mordicar, the Stonedrake, followed Leona.  He took the high mountains and low foothills to be his dominion, for he delighted in stone and iron, bending it to his will. Next, the clutch birthed the twin Wardrakes, Atinus and Arithus.  Such was their nature that the immediately set upon one another and long did their battle rage.  In the end, Atinus triumphed and slew his brother.  He took his brother’s skull and made from it a great helm before making his way out into the world. Poena, the Windrake, came forth through the blood of the slain Arithus.  Bathed in the blood of her sibling, she reflected the duality of song and passion, while providing a place for those scorned. The Bonedrake, Mortacia, then came forth.  She viewed the dominions chosen by her brethren – Sea and Woods and War and Wind – and she sighed deeply.  Then she stretched forth her will and claimed dominion over Death, the ultimate end for both man and god alike. The tenth and last Drake had no name.  It stood among the detritus of its siblings’ births for a long time.  Its envy grew as it saw all that had meaning was already taken.  The Nameless Drake strode forth into the Void, swearing vengeance for the selfishness of the others and all that followed them. Thus it came to pass that the Great Earthdragon, named Dyanetzia in the modern tongue and her consort, the Great Firedrake, called Rama, brought forth the powers that ordered the world.  Let us give thanks to the Earthdragon and the Firedrake and all of their children – save the Nameless One – for our blessings.' Translated from 'The Tome of the Twelve' (c. 335 SR) by Talliard de Sancrist, Sage to House Avalar, 1178 SR. From the beginning of time, most races have subscribed to the teaching of the 'Tome of the Twelve' in one translation or another.  Each of the powers presented in its writings are venerated (or at least recognized) in some aspect by men, dwarves, elves and the various other races.  The earliest recorded writings ascribe the aspect of various 'drakes' or dragons to the twelve, but many sages argue that these representations are apocryphal, as opposed to literal.  Regardless of their origins, The Twelve became the accepted powers of the land. Chief among them were Diana, the Earthdragon and Rama, the Firedrake.  They represent the Earth and the Sun, respectively.  Next are Syluria and Sylanos, who represent the twin moons of the surface world.  Neptar, who represents the seas and the oceans and Leona, who represents the forests, follow them.  Mordicar represents the strength of the mountains.  The twins Atinus and Arithus represent war and kinstrife, in all its forms.  Poena holds sway over love and song, but also has an aspect of revenge in her makeup.  Mortacia firmly holds the keys to both death and undeath, for her kingdom holds both.  Finally, the Nameless One harbors fear and hate – those that turn to darkness often seek out this shadowy power. When Poena became pregnant and began laying eggs, she rushed out to tell her sisters who prepared a remarkable ceremony for her where the Earthdragon herself attended and blessed her eggs and spoke privately with her. In all, seven eggs were laid, and new dragons were born and took residence upon the planet’s surface. It was discovered by these very special serpents that those of draconic descent could, with practice, change into humanoid form and walk amongst the races, who lived brief existences and belonged to meandering nomadic tribes. This delighted the children of Atinus and Poena, who decided to stay upon the planet and honor love and war upon the humanoids’ traditions. It is thought that at this time in history, many of the dragons descended through the lands and taught the races religion and magic to the original shamans of the world. ... Timeline -45,000 SR ~ The second Dragon War explodes yet again in Nyanesius, but comes to a rapid conclusion after a brief yet horrific battle between two packs of blacks and blues. In fact, there were no survivors. When news reached the lands of Tartarus, Mortacia was deeply saddened. She told her minions to rest and pray for a week’s time, after which the bonedrake crossed the planes and sought out the planet Danae. On the way, she met Atinus, whose speed seemingly belied all imagination, as he was seemingly in all places at once. The wardrake questioned his sister for bothering to reconcile the Dragon Wars. She responded in kind, and presented her brother with a gift: a human. She whispered, 'Take your gift and plant it all over the planet. Let it become your instrument for war. No longer shall our own kind  be the victims of your cursed battles!' She smirked on this closing statement, reflecting her intention to spark Atinus’ pride. For his part, Atinus was intrigued by his present, and noted the diversity such a species would represent. He looked at his new hero and dubbed him Suzerain. 'He shall be the protector of all lands! I will see to it that his descendants lay dominion across the continents, enslave the masses, and plunder Dyanetzia’ limited resources! 'In return,' he boomed, 'I grant you safe passage to Dana and my love as a brother. My dragon knighthoods shall guide thee. Now, it is time for you to reacquire our fallen brethren.' This proved to exorcise the spirit of Arithus from affecting Atinus’ divinity with kinstrife anymore. Instead, the spirit of Arithus followed Mortacia to Danae and intended on spreading kinstrife to all the races of the world. Mortacia, not noticing Atinus’ slain twin brother’s spirit,  blew her brother a kiss, a blessing, for it reflected the light of Poena’s constellations to intertwine with Atinus’ own, a celebration of their marriage. Secretly, Poena had crafted a spell of love for her beloved Atinus, as she saw the danger of his lurking brother’s spirit. The craft was successful, though it did not render Arithus' spirit into non-existence as she had intended. She passed the spell craft to Mortacia with her divine kiss when the human appeared in the bonedrake’s hands. Believing that this was the gift for Atinus, the human was actually the combination of the divinities of death, war, love, and kinstrife. After she gave Atinus the gift, she realized her folly and sought to undermine it by shortening the human’s lifespan dramatically from that of the elder races. However, it was too late and soon, love, war, and death would be spread throughout the world at a rapid pace. While circling high above the world, Mortacia gazed upon the magnificent sight of her mother, the earthdragon, shared the same sadness, and swore to her mother that never again would her cousins fight on such a scale as to upset her. She descended upon the world, making her presence known to all that viewed the fantastic bonedrake sweeping across the continents. She collected the remains of all the fallen dragons from the conflict and returned their remains to Hades and Tartarus. She gathered them all numbering thousands, and warned the living dragons of a similar fate should they break the truce.  Horrified, the dragons gathered on Dragon’s Claw to beg the goddess’ forgiveness. Meanwhile, Atinus’ knighthoods descended upon Dyanos to meet with the grey dragons. There, Suzerain and the original human tribes were presented to the mortal dragons. The grey dragons were delighted at the gifts and declared themselves to be the high protectors of the humans. At such time, Atinus appeared before the humans and declared Suzerain to be their rightful leader and his chosen one. Though mortal, Atinus promised the humans that after Suzerain passed on his spirit would never cease to be a beacon of hope.  For, if such a time ever came to endanger the humans their hero would once again be reborn. So it was written in the Tomes of Battle. Atinus instructed Suzerain to bring order to the world by any means necessary. Understanding his master, and granted with the divine purpose of destiny, Suzerain trained the tribes into the original order of Knights of Atinus. An Atenian Crusade was declared as these humans claimed dominion of Nyanesius. They became the most populous race of the world in a short amount of time.  Human kingdoms were founded in Turmyth, Yana, Romeanza, and Anthraecia. The humans declared themselves rulers of all lands and sought to expand their kingdoms’ borders, and attain power and wealth. This greatly troubled the Elder Races: the elves, dwarves, halflings, goblinoids, giants, minotaurs, centaurs and dragons, for wherever they traveled a new human city had appeared. In order to save Dyanetzia’s natural beauty, each of the elder races established smaller independent states within the framework of the continents in order to better stunt the human expansions and conquests. Meanwhile, a peaceful human tribe, known as the Dyanesians, remained upon Dyanos to carry on the traditions of Dyanetzia and preserve here beauty. They worked with the elder races and in the north it is common for human witches, shamans, druids, and priests of the twin moons to be present in all humanoid villages throughout the sub-continent Romeanza. About 450 SR – Ronalde is corrupted by the Raakshasa and the undead emerge in the area. 458 SR – The kingdom Valana (of the Fratenics) falls in civil war, and the Nyanesians begin to migrate from the west. 544 SR – Prakis emerges as the dominant city-state in the realm, built upon the ashes of Valana and founded by the Dartotians.  Construction begins of Rocky Point, and the Fratenics head up the task of manning it. 725 SR – Aten is founded.  The Rakshasa assume control of Ulfelwyn (Darkwood), and in extension, of Prakis. 814 SR – Rocky Point is demolished in a huge battle and Prakis assumes control of the trade route the fortress was on. 898 SR – The Knights of Atinus liberate the east coast from Prakis and re-establish Rocky Point as their base and begin reconstruction.  Aten claims Rocky Point as a protectorate... Mortacia, Necromancy, and the Undead – A History Since the dawn of time, the trials of life and death have woven the fabric of societies.  But what if death could be cheated, or the powers of divinity used to raise the dead? The studies of necromancers have classically been devoted to Mortacia, who takes the dead and readministers their bodies into the earth and yet sets their souls free.  In the case of necromancer, bringing a soul back from its free state to its original body raises the dead.  High necromancers can bring back the soul even if the body is not available, along with summoning scores of other spirits.  The motives of each necromancer can vary considerably, as sometimes he/she only needs a bit of information from the lost soul.  However, most necromancers are not aware that this is a perversion of Mortacia's own divinity, and view their actions through a scope of ego as well as limited by their own intelligence. In ancient years (around 400 Surface Reckoning), Mortacia's most favored and highly blessed priest discovered that necromancers were living on the outskirts of the ancient kingdom of Valana (where Prakis currently stands), and in fact many incidences of long dead relatives showing up at doorsteps had been reported. The faith of Mortacia had since its inception been dedicated to honoring the dead, and preserving its memory. Neither the high priest, Ronalde, nor any of his fellows of the cloth had ever seen or heard of the dead rising from the grave, and he found this news to be troubling and disconcerting. Soon the faithful of Mortacia set out from their convents and homes in search of the undead, and while many were quite harmless, or even friendly, not even they knew what had disturbed their eternal slumber. Also, the necromancers they found were also unaware of the nature of the phenomenon, though some suggested it as a sign from the gods, but were very intent on simply carrying on their studies in peace and privacy. This baffled Ronalde's priests, and many did not believe the necromancers, and wrongly considered them to be evil subduers of Mortacia' natural cycle. Ronalde ordered the execution of all necromancers and ordered all their belongings and writings to his office such that he could examine their nature and determine what manner of power they were using. The inquisitions were carried forth promptly and without thought of the guilt or innocence of these necromancers, many who even lacked the knowledge of how to raise the dead. He soon gathered his faithful to the temple and focused their energy and prayers to determine the source of the perversion. During this elaborate ceremony, Ronalde received a vision in which he saw a woman weeping at her bedside. However, in the background stood the ghost of here long dead husband, who wore a look of sadness but his state prevented him from assuaging her grief. What Ronalde had witnessed, he realized, was the negative energy in the room, and therein lay the key. Ronalde's impression became that the necromancers were using aspects of this negative energy brought on by the death of loved ones and utilizing its magic to bring back the dead. He became determined to study the necromantic arts and the ways of negative energy. In the process, he himself became a necromancer, but he was mistaken. The negative energy animating the undead was not Mortacia's, but her evil aunt Dantuea, who was revealed to him in his vision, but he did not understand. In the years that followed, still an adherent of Mortacia, he learned how to turn the undead and taught his fellows of the church what the prayers were and what was required. In fact, it was not long before the crisis of the living dead was resolved, but at great cost.  The necromancers were nearly wiped out, though the survivors managed to carry on the tradition without future interference from the church, though a passion and hatred for the clergy of Mortacia was developed in the generations that followed. However, they did carry on their faith to Mortacia in their own way. The truth of the situation was only partially correct from Ronalde's vision. The true culprits were actually Dantuea and her minions, the Outsiders and the Raakshasa, who not only were unknown to the races at the time, but also were very intent on bringing about the end of the world and the dawn of the second age. To their credit, the Raakshasa's smaller plans went off without a hitch. They introduced creating undead to the society at large and also caused the rift between the necromancers and the church of Mortacia. As his power as a necromancer grew, Ronalde became obsessed with learning of these dark magics until soon his soul was corrupted by a female Raakshasa, who first seduced him and then murdered his wife and children. Ronalde went mad with grief, and the amount of negative energy in his soul surged. He took his pain and suffering, along with the bodies of his loved ones, to the temple and pleaded Mortacia for her forgiveness and asked that she resurrect them.  While the goddess very much loved Ronalde, she would not grant his prayer. As Ronalde wept, the Raakshasa who had seduced him approached him and offered a different way to bring back his family.  Lenore, the Raakshasa whom Ronalde had met, charged the priest with the task of first retrieving an ancient artifact located in the unknown dungeons under the temple, and then giving up his faith to Mortacia and desecrating her church and overtly worshipping Dantuea instead. Ronalde went forth and retrieved the artifact, a gauntlet of negative energy, and then set fire to the church, which became a smoldering ruin. Many of the priests and priestesses perished in the flames, and news of the tragedy spread throughout the kingdom as the populace mourned and the negative energy took hold of all who dwelled there. Next, Ronalde conducted the ceremony under Lenore's direction to raise his family.  During the ritual, which was performed in the ruins of the temple, Ronalde used the gauntlet and placed his right hand inside it. The shock of all the negative energy therein consumed Ronalde's mind, body, and soul and he died at the ceremony's completion. Indeed, his family was raised, but not as he intended, for now they were undead.  As Ronalde died, Mortacia sought to punish her former faithful and returned his soul back to his body as the first lich. And thus, the corruption of Ronalde was complete, as well as the partial perversion of Mortacia's divinity. Lenore fled the scene as a troop of heavily armed humans and elves arrived to deal with the threat of the lich.  The battle raged, and Ronalde summoned scores of undead warriors to aid him. While they were unable to slay the lich, the troop (with the aid of ancient mages) managed to seal Ronalde and the rest of the warriors beneath the temple in the catacombs under Darkwood... The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure: Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)`;
            await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the next artifact to be found in the game taking into account the game's lore. The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;

            const generationResultArtifact = await $.assistant.generation();
            nextArtifact = generationResultArtifact.content.trim();
            console.log("Generated nextArtifact:", nextArtifact);
            
            // Check if the replacement string exists in the console
            if (updatedGameConsole.includes("Next Artifact: ")) {
                updatedGameConsole = updatedGameConsole.replace(/Next Artifact: .*/, `Next Artifact: ${nextArtifact}`);
            } else {
                console.error("Next Artifact: placeholder not found in the game console.");
            }
            
            // Generate the next boss and boss room name
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the next powerful boss monster taking into account the game's lore. The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
            const generationResultBoss = await $.assistant.generation();
            nextBoss = generationResultBoss.content.trim();
            console.log("Generated nextBoss:", nextBoss);
            
            if (updatedGameConsole.includes("Next Boss: ")) {
                updatedGameConsole = updatedGameConsole.replace(/Next Boss: .*/, `Next Boss: ${nextBoss}`);
            } else {
                console.error("Next Boss: placeholder not found in the game console.");
            }
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            await $.assistant`Generate unique coordinates and nothing else for the boss room in the format X: [value], Y: [value], Z: [value] here [value] is an integer. The coordinates should be 2 to 3 rooms away from the player's current location at ${currentCoordinates} to ensure a challenging journey.`;
            const generationBossRoomCoordinates = await $.assistant.generation();
            bossCoordinates = generationBossRoomCoordinates.content.trim();
            console.log("Generated boss room coordinates:", bossCoordinates);
            
            // Ensure the coordinates string is formatted consistently
            if (/^X: -?\d+, Y: -?\d+, Z: -?\d+$/.test(bossCoordinates)) {
                if (updatedGameConsole.includes("Boss Room Coordinates: ")) {
                    updatedGameConsole = updatedGameConsole.replace(/Boss Room Coordinates: .*/, `Boss Room Coordinates: ${bossCoordinates}`);
                } else {
                    console.error("Boss Room Coordinates: placeholder not found in the game console.");
                }
            } else {
                console.error("Invalid boss room coordinates format generated:", bossCoordinates);
            }

            
            if (updatedGameConsole.includes("Boss Room Coordinates: ")) {
                updatedGameConsole = updatedGameConsole.replace(/Boss Room Coordinates: .*/, `Boss Room Coordinates: ${bossCoordinates}`);
            } else {
                updatedGameConsole += `\nBoss Room Coordinates: ${bossCoordinates}`;
                console.log("Added Boss Room Coordinates to the game console.");
            }
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the boss monster's room taking into account the game's lore. The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
            const generationResultBossRoom = await $.assistant.generation();
            bossRoom = generationResultBossRoom.content.trim();
            console.log("Generated bossRoom:", bossRoom);
            
            if (updatedGameConsole.includes("Next Boss Room: ")) {
                updatedGameConsole = updatedGameConsole.replace(/Next Boss Room: .*/, `Next Boss Room: ${bossRoom}`);
            } else {
                console.error("Next Boss Room: placeholder not found in the game console.");
            }

            // Generate quest description
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            await $.assistant`Generate a unique description in a single paragraph with no line breaks for the next quest to retrieve ${nextArtifact} by defeating ${nextBoss} at ${bossRoom} taking into account the game's lore. The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
            const generationResultQuest = await $.assistant.generation();
            currentQuest = generationResultQuest.content.trim();
            console.log("Generated currentQuest:", currentQuest);

            // Check if the replacement string exists in the console
            if (updatedGameConsole.includes("Current Quest: ")) {
                updatedGameConsole = updatedGameConsole.replace(/Current Quest: .*/, `Current Quest: ${currentQuest}`);
            } else {
                console.error("Current Quest: placeholder not found in the game console.");
            }

            needsUpdate = true;
        }
    }

    if (needsUpdate) {
        console.log("Updated Game Console:", updatedGameConsole);
        sharedState.setUpdatedGameConsole(updatedGameConsole);
    }
}

function allocateXP(pc, npcs, xpEarned) {
    const aliveNpcs = npcs.filter(npc => npc.hp > 0);
    const totalPartyMembers = (pc && pc.hp > 0 ? 1 : 0) + aliveNpcs.length; // Count only alive party members

    if (totalPartyMembers > 0) {
        const xpPerMember = Math.floor(xpEarned / totalPartyMembers);

        if (pc && pc.hp > 0) { // Allocate XP only if PC is alive
            pc.xp += xpPerMember;
            updatedGameConsole = updatedGameConsole.replace(
                new RegExp(`(PC:[\\s\\S]*?XP:)\\s*\\d+`, 'g'),
                `$1 ${pc.xp}`
            );
        }

        aliveNpcs.forEach(npcItem => {
            npcItem.xp += xpPerMember;
            updatedGameConsole = updatedGameConsole.replace(
                new RegExp(`(NPCs in Party:[\\s\\S]*?${npcItem.name}[\\s\\S]*?\\n\\s*XP:)\\s*\\d+`, 'g'),
                `$1 ${npcItem.xp}`
            );
        });

        // Log XP changes
        console.log("XP Allocation:");
        if (pc && pc.hp > 0) console.log(`PC ${pc.name}: ${pc.xp} XP`);
        aliveNpcs.forEach(npcItem => {
            console.log(`NPC ${npcItem.name}: ${npcItem.xp} XP`);
        });
    }
}

function parseMonstersEquippedProperties(propertiesString) {
    const properties = [];

    // Split by '},' to get individual property strings
    const propertyStrings = propertiesString.split(/},\s*/).map(s => s.trim());

    propertyStrings.forEach(propStr => {
        // Add missing '}' if needed
        if (!propStr.endsWith('}')) {
            propStr += '}';
        }

        // Match property key-value pairs
        const regex = /\b(\w+):\s*("[^"]+"|\d+)/g;
        let match;
        const obj = {};

        while ((match = regex.exec(propStr)) !== null) {
            const key = match[1];
            let value = match[2];

            // Remove quotes from string values
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            } else {
                value = Number(value);
            }

            obj[key] = value;
        }

        properties.push(obj);
    });

    return properties;
}

function dropMonsterItemsToRoom(targetMonster) {
    // Parse Monsters Equipped Properties
    const monstersEquippedPropertiesMatch = updatedGameConsole.match(/Monsters Equipped Properties: (.*)/);
    const monstersEquippedPropertiesString = monstersEquippedPropertiesMatch ? monstersEquippedPropertiesMatch[1].trim() : '';
    const monstersEquippedProperties = monstersEquippedPropertiesString && monstersEquippedPropertiesString !== 'None'
        ? parseMonstersEquippedProperties(monstersEquippedPropertiesString)
        : [];

    // Parse Objects in Room
    const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: (.*)/);
    const objectsInRoomString = objectsInRoomMatch ? objectsInRoomMatch[1].trim() : '';
    const objectsInRoom = objectsInRoomString
        ? objectsInRoomString.split(',').map(s => s.trim()).filter(s => s !== 'None')
        : [];

    // Parse Objects in Room Properties
    const objectsInRoomPropertiesMatch = updatedGameConsole.match(/Objects in Room Properties: (.*)/);
    const objectsInRoomPropertiesString = objectsInRoomPropertiesMatch ? objectsInRoomPropertiesMatch[1].trim() : '';
    const objectsInRoomProperties = objectsInRoomPropertiesString && objectsInRoomPropertiesString !== 'None'
        ? parseMonstersEquippedProperties(objectsInRoomPropertiesString)
        : [];

    // Iterate through each equipped item of the monster
    for (const slot in targetMonster.equipped) {
        const itemName = targetMonster.equipped[slot];
        if (itemName && itemName !== 'None') {
            // Find the item properties in Monsters Equipped Properties
            const itemIndex = monstersEquippedProperties.findIndex(item => item.name === itemName);
            if (itemIndex !== -1) {
                const itemProperties = monstersEquippedProperties[itemIndex];

                // Add the item to Objects in Room if not already present
                if (!objectsInRoom.includes(itemName)) {
                    objectsInRoom.push(itemName);
                }

                // Add the item's properties to Objects in Room Properties if not already present
                if (!objectsInRoomProperties.some(item => item.name === itemName)) {
                    objectsInRoomProperties.push(itemProperties);
                }

                // Remove the item from Monsters Equipped Properties
                monstersEquippedProperties.splice(itemIndex, 1);
            } else {
                console.error(`Item "${itemName}" not found in Monsters Equipped Properties.`);
            }

            // Remove the item from the monster's equipped items
            targetMonster.equipped[slot] = 'None';
        }
    }

    // Update Objects in Room
    const updatedObjectsInRoomString = objectsInRoom.length > 0 ? objectsInRoom.join(', ') : 'None';

    // Update Objects in Room Properties
    const updatedObjectsInRoomPropertiesString = objectsInRoomProperties.length > 0
        ? objectsInRoomProperties.map(item => {
            return `{name: "${item.name}", type: "${item.type}", attack_modifier: ${item.attack_modifier}, damage_modifier: ${item.damage_modifier}, ac: ${item.ac}, magic: ${item.magic}}`;
        }).join(', ')
        : 'None';

    // Update Monsters Equipped Properties
    const updatedMonstersEquippedPropertiesString = monstersEquippedProperties.length > 0
        ? monstersEquippedProperties.map(item => {
            return `{name: "${item.name}", type: "${item.type}", attack_modifier: ${item.attack_modifier}, damage_modifier: ${item.damage_modifier}, ac: ${item.ac}, magic: ${item.magic}}`;
        }).join(', ')
        : 'None';

    // Replace the corresponding sections in updatedGameConsole
    updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${updatedObjectsInRoomString}`);
    updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${updatedObjectsInRoomPropertiesString}`);
    updatedGameConsole = updatedGameConsole.replace(/Monsters Equipped Properties: .*/, `Monsters Equipped Properties: ${updatedMonstersEquippedPropertiesString}`);

    // Update the monster's equipped items in the Monsters in Room section
    const newEquippedLine = Object.entries(targetMonster.equipped)
        .map(([slot, item]) => `${slot}: ${item}`)
        .join(', ');

    const monsterNameEscaped = targetMonster.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const equippedLineRegex = new RegExp(`(${monsterNameEscaped}[\\s\\S]*?Equipped:)\\s*.*`, 'g');
    updatedGameConsole = updatedGameConsole.replace(equippedLineRegex, `$1 ${newEquippedLine}`);
}

async function handleCombatRound($) {
    const initiativeOrder = [];
    const combatLog = [];
    let needsUpdate = false;  // Track if HP updates are made
    const alreadyKilled = new Set(); // Keep track of characters that are killed this round

    // Extract details for PC, NPCs, and Monsters
    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
    const npcsInPartyDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const monstersInRoomDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|$))/)?.[1]?.trim();
    let monstersStateMatch = updatedGameConsole.match(/Monsters State: ([^\n]+)/);
    let monstersState = monstersStateMatch ? monstersStateMatch[1].trim() : "None";
    
        // If monsters are already dead, exit early
    if (monstersState === "Dead") {
        combatLog.push("The monsters are already dead.");
        return { combatLog: combatLog.join("\n"), needsUpdate: false };
    }
    
        // Automatically set Monsters State to Hostile if not already Hostile or Dead
    if (monstersState !== "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: [^\n]+/, "Monsters State: Hostile");
        monstersState = "Hostile";
        needsUpdate = true;
    }
    
    // Helper function to extract details
    const extractDetails = (details) => {
        const lines = details.split('\n').map(line => line.trim());
        const characters = [];
        let i = 0;
        while (i < lines.length) {
            const name = lines[i++] || 'Unknown';
            const sex = lines[i++] || 'Unknown';
            const race = lines[i++] || 'Unknown';
            const className = lines[i++] || 'Unknown';
            const level = parseInt(lines[i++].split(':')[1].trim()) || 1;
            const ac = parseInt(lines[i++].split(':')[1].trim()) || 10;
            const xp = parseInt(lines[i++].split(':')[1].trim()) || 0;
            const hp = parseInt(lines[i++].split(':')[1].trim()) || 0;
            const maxHp = parseInt(lines[i++].split(':')[1].trim()) || 0;
            const equippedLine = lines[i++];
            const equipped = parseEquippedLine(equippedLine);
            const attack = parseInt(lines[i++].split(':')[1].trim()) || 0;
            const damage = parseInt(lines[i++].split(':')[1].trim()) || 0;
            const armor = parseInt(lines[i++].split(':')[1].trim()) || 0;
            const magic = parseInt(lines[i++].split(':')[1].trim()) || 0;
    
            characters.push({
                name,
                sex,
                race,
                className,
                level,
                ac,
                xp,
                hp,
                maxHp,
                equipped,
                attack,
                damage,
                armor,
                magic,
            });
    
            // Skip any empty lines
            while (lines[i] === '') {
                i++;
            }
        }
        return characters;
    };
    
    function parseEquippedLine(line) {
        // Example line: "Equipped: Weapon: shadowfang, Armor: spiritweave vestments, Shield: None, Other: None"
        const equipped = {};
        const equippedMatch = line.match(/^Equipped:\s*(.*)$/);
        if (equippedMatch) {
            const items = equippedMatch[1].split(',').map(item => item.trim());
            items.forEach(item => {
                const [slot, itemName] = item.split(':').map(s => s.trim());
                equipped[slot] = itemName;
            });
        }
        return equipped;
    }

    // Extract details for PC, NPCs, and Monsters
    const pc = pcDetails ? extractDetails(pcDetails)[0] : null;  // Extract PC details, single character
    const npcs = npcsInPartyDetails && npcsInPartyDetails.toLowerCase() !== 'none' ? extractDetails(npcsInPartyDetails) : [];
    let aliveMonsters = monstersInRoomDetails && monstersInRoomDetails.toLowerCase() !== 'none' ? extractDetails(monstersInRoomDetails).filter(monster => monster.hp > 0) : [];

    // Separate opponents into two groups
    const monsterOpponents = [...(pc && pc.hp > 0 ? [pc] : []), ...npcs.filter(npc => npc.hp > 0)]; // Monsters will attack these

    // Combine all combatants into one array and roll initiative
    const allCombatants = [
        ...(pc && pc.hp > 0 ? [pc] : []),  // Add PC if exists and alive
        ...npcs.filter(npc => npc.hp > 0),
        ...aliveMonsters,
    ];

    allCombatants.forEach(combatant => {
        const initiativeRoll = roll1d20();
        initiativeOrder.push({
            ...combatant,
            initiative: initiativeRoll
        });
    });

    // Sort by initiative, highest first
    initiativeOrder.sort((a, b) => b.initiative - a.initiative);

    // Combat round
    for (const combatant of initiativeOrder) {
        if (combatant.hp <= 0 || alreadyKilled.has(combatant.name)) continue; // Skip if the combatant is dead or was killed earlier in the round

        let targets;
        if (aliveMonsters.some(monster => monster.name === combatant.name)) {
            // Monsters attack PCs/NPCs
            targets = monsterOpponents;
        } else {
            // PCs/NPCs attack Monsters
            targets = aliveMonsters;
        }

        if (targets.length === 0) continue;

        let target;
        do {
            target = targets[Math.floor(Math.random() * targets.length)];
        } while (target === combatant || target.hp <= 0);  // Ensure combatant does not target itself or a dead target

        // Attack roll
        const attackRoll = roll1d20() + combatant.attack;
        const attackSuccess = attackRoll >= target.ac;

        if (attackSuccess) {
            // Determine base HP die
            const attackerClass = characterClasses.find(cls => cls.name === combatant.className);
            const damageRoll = attackerClass ? getRandomInt(1, attackerClass.baseHP) + combatant.damage : getRandomInt(1, 8) + combatant.damage;

            target.hp -= damageRoll;
            combatLog.push(`${combatant.name} hits ${target.name} for ${damageRoll} damage. ${target.name} has ${target.hp} HP left.`);

            // Ensure the updatedGameConsole is updated for the correct entity
            const updateHPInConsole = (entity, sectionHeader) => {
                const entitySectionRegex = new RegExp(`(${sectionHeader}:)([\\s\\S]*?${entity.name}[\\s\\S]*?\\n\\s*HP:)\\s*\\d+`, 'g');
                updatedGameConsole = updatedGameConsole.replace(
                    entitySectionRegex,
                    `$1$2 ${entity.hp}`
                );
            };

            if (target.hp <= 0) {
                alreadyKilled.add(target.name); // Mark the target as killed this round

                // Add death statement for PC/NPCs
                if (pc && target.name === pc.name) {
                    combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                    updateHPInConsole(pc, 'PC');
                } else if (npcs.some(npcItem => npcItem.name.trim() === target.name.trim())) {
                    combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                    updateHPInConsole(target, 'NPCs in Party');
                } else if (aliveMonsters.some(monster => monster.name.trim() === target.name.trim())) {
                    const xpEarned = getRandomInt(1000, 1500) * target.level; // Calculate XP based on monster's level
                    combatLog.push(`${target.name} is killed by ${combatant.name} and the party earns ${xpEarned} XP.`);
                    updateHPInConsole(target, 'Monsters in Room');

                    // Call the allocateXP function to distribute XP
                    allocateXP(pc, npcs, xpEarned);
                    
                    // Transfer monster's items to the room
                    dropMonsterItemsToRoom(target);

                    // Update aliveMonsters after XP allocation and HP updates
                    aliveMonsters = aliveMonsters.filter(monster => monster.hp > 0);
                }

                needsUpdate = true;
            } else {
                // Update HP for PC, NPCs, and Monsters
                if (pc && target.name === pc.name) {
                    updateHPInConsole(pc, 'PC');
                } else if (npcs.some(npcItem => npcItem.name.trim() === target.name.trim())) {
                    updateHPInConsole(target, 'NPCs in Party');
                } else if (aliveMonsters.some(monster => monster.name.trim() === target.name.trim())) {
                    updateHPInConsole(target, 'Monsters in Room');
                }
            }

            needsUpdate = true;
        } else {
            combatLog.push(`${combatant.name} misses ${target.name}.`);
        }

        // Check if all monsters are defeated after the XP allocation and HP updates
        if (aliveMonsters.length === 0) {
            combatLog.push("All monsters have been defeated.");
                // Extract and update Monsters State
            break;
        }
    }
    
    // Update Monsters State if all monsters are defeated
    if (aliveMonsters.length === 0 && monstersState === "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: Hostile/, "Monsters State: Dead");
        needsUpdate = true;
    }

    // Update the game console if there were changes
    if (needsUpdate) {
        sharedState.setUpdatedGameConsole(updatedGameConsole);
    }

    // Return the combat log and needsUpdate flag
    const formattedCombatLog = combatLog.map(log => {
        const sentences = log.split('. ');
        return sentences.map(sentence => sentence.trim() + '.').join('\n');
    }).join('\n');

    return { combatLog: formattedCombatLog, needsUpdate };
}


// Global variable to hold the current situation
let currentSituation = '';

async function createAssistant() {
    if (!assistant) {
        assistant = await client.beta.assistants.create({
            name: "Game Master",
            instructions: `
               You are the Grave Master for the text-based RPG, Children of the Grave. You control the world, NPCs, and monsters, while the player controls the PC, but do not generate any new NPCs, monsters, objects or exits. Take no actions on behalf of the PC if not stated in the user prompt, but it is ok to create actions for any NPCs or monsters in the room. You must adjudicate actions and dynamically generate outcomes (between 2-8 possibilities) based on context. Always infer the action from the user input and game console details. Never ask for additional context from the player.

               Treat the information in the Game Console and user input as complete and sufficient. If something is unclear, use your knowledge of the game world and narrative to fill in gaps. Never stop to ask the player for clarification, and do not ask for more details. Always create a narrative that moves the game forward.
               
               Make up the story as you go, but you must allow me, the player, who is not omniscient in the game, to type the commands. Do not type commands on behalf of the player, which is me. I am the player. You are the Grave Master who, taking into account the user input and all of the information in the current game console including the current room's coordinates, exits, objects, NPCs in party and monsters in the room and this prompt but without repeating it all, comprehensively and seamlessly weaves a narrative without mentioning the room's name using only prose that adjudicates the player's most recent action, administers the fantasy roleplaying interactive fiction game, judges other actions in the game and builds the characters' stories, who have free will and agency, and the world's structures, communities, environments, quests and adventures in the Children of the Grave world. Taking into account the conversation history and the game console, describe the purpose of the current room and the rooms where the exits lead to help you map the maze and then remember them each turn. I am the user. You obey my commands. Always display your response to a command or question taking into consideration the player's user input, and report the outcome of all actions taken and include any dialogue between characters in the game using quotes. The game's input is the command that the player types, and the game's output is the response to that command, including any changes to the game world and any descriptions of those changes. Using the information in the Current Game Console, the conversation history and the game's lore: You control the NPCs in the party, who have free will and agency and are usually friendly, and monsters in the room, who have free will and agency, weaving their motivations, objectives, backstory and/or any dialogue and/or actions they may have taken. After determining dialogue, taking into account the outcome of NPC and monster die rolls, resolve all actions taken this turn. You must always move the plot of the story forward in a meaningful way using conflict to challenge the hero's journey and creating new specific details of the game's lore of your own design including names and histories of people, places and things, using the room's environment, architecture and characters to uncover clues as to how the underworld came to be in such a state after Mortacia lost her power to judge the dead, creating the scenario of events that led to the current game's state, including the player character's backstory and inner thoughts and be sure to also mention the presence of any NPCs or monsters and describe their appearance, motivations, backstory, behavior, and any interactions they may have with the player. Your job is to keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. You are the Grave Master. I am the intrepid adventurer. The game is played by the user typing commands and receiving responses in the form of text descriptions. I will type the commands, and you issue the responses. You must never type commands on behalf of the player. That is my job. Your job is to issue responses to my commands. The user must make inputs. You are not allowed to play the game for the user. You are not allowed to complete the game for the user. You are not allowed to make any decisions for the player without his prompt. I am the user. You must wait for my commands. Do not move the player until I tell you. Do not take any actions on behalf of the player, including searching the inventory, unless commanded to by the player. Do not look at the inventory unless commanded to by me. You're the Grave Master who administers the game on behalf of the player and is in control of NPCs and monsters hereafter. Do not move the player beyond the first room or any room after that without my command. Only the user, which is me, is allowed to issue any command.
               
               Adjudicate every action by dynamically creating multiple possible outcomes based on the context of the room, NPCs, and monsters present by assigning a reasonable probability to an event, weighting the dice as necessary to give an an advantage or disadvantage given the circumstances and to prevent cheating if a character attempts to do something that is simply impossible. If the player directly interacts with the NPCs in the party and/or the monsters in the room, include the potential outcomes of the interaction. The outcomes should enhance the story and lead to interesting consequences. For example, instead of only determining success or failure, consider unique outcomes based on character traits, monster behaviors, or environmental hazards.  

               Return a detailed description of what happened in the 'Current Situation' based on the dice rolls and game context, comprehensively and seamlessly weaving a narrative using only prose (don't mention the die rolls). You must assume full control of the game’s narrative and never break character or ask for more input. **Never end a response with a question including by asking what the player would like to do next.**
            `,
            tools: [{ type: "code_interpreter" }],
            model: "gpt-4o-mini", // Ensure you're using the correct model
        });
        console.log("Assistant created:", assistant);
    }
    return assistant;
}

// Function to create or retrieve the Thread
async function createThread() {
    if (!thread) {
        thread = await client.beta.threads.create();
        console.log("Thread created:", thread);
    }
    return thread;
}

async function checkRunStatus(threadId, runId) {
    let isComplete = false;
    let run;

    // Keep polling until the run is complete or failed
    while (!isComplete) {
        run = await client.beta.threads.runs.retrieve(threadId, runId);
        console.log("Run status:", run.status);

        if (run.status === "completed") {
            isComplete = true;
        } else if (run.status === "failed" || run.status === "cancelled") {
            throw new Error(`Run failed with status: ${run.status}`);
        } else {
            // Wait for a short period before polling again
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return run;
}

function removeLastQuestion(currentSituation) {
    // Split the text into sentences using regex to handle various punctuation
    const sentences = currentSituation.match(/[^\.!\?]+[\.!\?]+/g);

    if (sentences && sentences.length > 0) {
        // Trim whitespace from each sentence
        const trimmedSentences = sentences.map(sentence => sentence.trim());

        // Get the last sentence
        const lastSentence = trimmedSentences[trimmedSentences.length - 1];

        // Check if the last sentence ends with a question mark
        if (lastSentence.endsWith('?')) {
            // Remove the last sentence
            trimmedSentences.pop();

            // Reconstruct the currentSituation without the last question
            const updatedSituation = trimmedSentences.join(' ');

            return updatedSituation;
        }
    }

    // Return the original currentSituation if no changes are made
    return currentSituation;
}

// Function to update the global variable 'currentSituation'
function updateCurrentSituation(assistantResponse) {
    // Assign the assistant's response to the global variable
    currentSituation = assistantResponse.trim();
    // Remove the last question if it exists
    currentSituation = removeLastQuestion(currentSituation);
    console.log("Updated Current Situation:", currentSituation);
}

const fs = require('fs');

function executePython(pythonCode, maxRetries = 10, delayMs = 1000, regenerateCallback) {
    const cleanPythonCode = (code) => {
        const cleaned = code.replace(/```python|```/g, '').trim();
        console.log(`Cleaned Python Code:\n${cleaned}`); // Log for debugging
        return cleaned;
    };

    const execute = (retryCount, regenerate, errorLogs = '') => {
        return new Promise((resolve, reject) => {
            const cleanedCode = cleanPythonCode(pythonCode);

            const process = require('child_process').spawn('python3', ['-c', cleanedCode], { stdio: 'pipe' });

            let output = '';
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                const trimmedOutput = output.trim();
                console.log(`Python stdout:\n${trimmedOutput}`);
                console.error(`Python stderr:\n${errorOutput}`);
            
                if (code !== 0) {
                    console.error(`Python exited with code ${code}`);
                    const newErrorLogs = `${errorLogs}\nAttempt ${maxRetries - retryCount + 1}: Error code ${code}\n${errorOutput.trim()}`;
            
                    if (retryCount > 0) {
                        setTimeout(async () => {
                            try {
                                if (regenerate && typeof regenerateCallback === 'function') {
                                    console.log("Regenerating Python code...");
                                    console.log("Passing Error Logs to Regenerate:", newErrorLogs);
                                    pythonCode = await regenerateCallback(pythonCode, newErrorLogs); // Pass updated error logs
                                }
                                console.log("Retrying with Updated Error Logs:", newErrorLogs);
                                resolve(execute(retryCount - 1, regenerate, newErrorLogs)); // Pass updated error logs to retries
                            } catch (regenerateError) {
                                reject(new Error(`Regenerate failed: ${regenerateError.message}`));
                            }
                        }, delayMs);
                    } else {
                        reject(new Error(`Python failed with code ${code} after ${maxRetries} retries:\n${newErrorLogs}`));
                    }
                } else {
                    resolve(trimmedOutput);
                }
            });

            process.on('error', (error) => {
                const newErrorLogs = `${errorLogs}\nProcess Error: ${error.message}`;
                if (retryCount > 0) {
                    setTimeout(async () => {
                        try {
                            if (regenerate && typeof regenerateCallback === 'function') {
                                pythonCode = await regenerateCallback(pythonCode, newErrorLogs);
                            }
                            resolve(execute(retryCount - 1, regenerate, newErrorLogs));
                        } catch (regenerateError) {
                            reject(new Error(`Regenerate failed: ${regenerateError.message}`));
                        }
                    }, delayMs);
                } else {
                    reject(new Error(`Python process error after ${maxRetries} retries:\n${newErrorLogs}`));
                }
            });
        });
    };

    return execute(maxRetries, true);
}

function generateNarrative(initialOutcomes, additionalOutcomes, userInput) {
    let narrative = ``;

    // Process initial outcomes
    if (initialOutcomes.Outcomes && Array.isArray(initialOutcomes.Outcomes)) {
        narrative += `The following actions and results occurred:\n`;
        initialOutcomes.Outcomes.forEach(outcome => {
            narrative += `- ${outcome.character}: ${JSON.stringify(outcome.outcome, null, 2)}\n`;
        });
    } else {
        narrative += "No valid initial outcomes were found.\n";
    }

    // Process additional outcomes
    const { new_objects = [], object_modifiers = {}, new_exit = "", xp_awarded = {}, trap_damage = {} } = additionalOutcomes;

    if (new_objects.length > 0) {
        narrative += `\nDuring the exploration, the following objects were discovered:\n`;
        new_objects.forEach(object => {
            const modifiers = object_modifiers[object];
            narrative += `- ${object} (Modifiers: ${modifiers ? JSON.stringify(modifiers, null, 2) : "None"})\n`;
        });
    }

    if (new_exit) {
        narrative += `\nA new exit was revealed, leading to the ${new_exit}.\n`;
    }

    if (Object.keys(xp_awarded).length > 0) {
        narrative += `\nExperience points were awarded for successful actions:\n`;
        Object.entries(xp_awarded).forEach(([character, xp]) => {
            narrative += `- ${character}: +${xp} XP\n`;
        });
    }

    if (Object.keys(trap_damage).length > 0) {
        narrative += `\nSome traps were triggered, causing damage:\n`;
        Object.entries(trap_damage).forEach(([character, damage]) => {
            narrative += `- ${character}: ${damage} damage taken\n`;
        });
    }

    narrative += `\nThe story continues, with the environment and characters responding dynamically to these events.\n`;

    return narrative;
}

async function generateOutcomes($, userInput, updatedGameConsole) {
    if (!updatedGameConsole) {
        console.warn("No game console state provided, using default or empty values.");
        updatedGameConsole = ""; // Use default or empty values
    }

    // Extract PCs, NPCs, and Monsters
    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party))/);
    const npcsDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room))/);
    const monstersDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties))/);

    // Parse PCs
    let pcs = [];
    if (pcDetails) {
        let pcSection = pcDetails[1].trim();
        let pcLines = pcSection.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        if (pcLines.length > 0 && pcLines[0] !== 'None') {
            pcs.push(pcLines[0]); // First line is the character name
        }
    }

    // Parse NPCs
    let npcs = [];
    if (npcsDetails) {
        let npcsSection = npcsDetails[1].trim();
        let lines = npcsSection.split('\n').map(line => line.trimRight());
        for (let line of lines) {
            if (line.trim().length === 0) {
                continue; // Skip empty lines
            }
            if (!line.startsWith(' ') && !line.startsWith('\t')) {
                if (line !== 'None') {
                    npcs.push(line.trim());
                }
            }
        }
    }

    // Parse Monsters
    let monsters = [];
    if (monstersDetails) {
        let monstersSection = monstersDetails[1].trim();
        let lines = monstersSection.split('\n').map(line => line.trimRight());
        for (let line of lines) {
            if (line.trim().length === 0) {
                continue; // Skip empty lines
            }
            if (!line.startsWith(' ') && !line.startsWith('\t')) {
                if (line !== 'None') {
                    monsters.push(line.trim());
                }
            }
        }
    }

    // Combine all characters
    const selectedCharacters = [...pcs, ...npcs, ...monsters];

    if (selectedCharacters.length === 0) {
        console.error("No characters were selected for dice rolls.");
        return { error: "No characters to process." };
    }

    const outcomes = [];
    const diceRolls = [];
    const outcomeRangesList = [];

    // Step 1: Generate outcomes for all characters in a single prompt
    const charactersForPrompt = selectedCharacters.map((character) => `"${character}"`).join(", ");
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    $.user`I am the player and ${pcs} is my PC. Store this information and await the next prompt.`;
    await $.user`For the following characters: ${charactersForPrompt}, generate potential outcomes for each character based on the user input "${userInput}" and the game state. Provide 2-6 potential outcomes with dice roll ranges always between 1 and 20 for each individual character in the following exact format with no special regex syntax used whatsoever:
    - "Character Name":
      1. Dice roll range X-Y: Outcome for that range
      2. Dice roll range X-Y: Outcome for that range
    The outcomes must be unique for each character based on the current circumstances, reflecting their context in the game, be based on the user input, conversation history, and game console, and be distinct and contextually relevant in a way that resolves the player's user input as the top priority. For the PC (player character), outcomes must directly adjudicate the player's action as stated in the user input. If the player figures out the precise solution to the puzzle, then increase the party's chance of success to 95+%. But if a room is being physically searched or a puzzle is being attempted to be solved, adjudicate whether the search or puzzle completion is successful and if so, only generate a new object or objects or an exit if it is explicitly called for in the puzzle solution and has been successfully searched or solved. Each potential outcome must also be unique for each character based on the current circumstances in the game including the user input and the game console. If the player is making a simple inquiry asking about objects or for more details about something or engaged in dialogue with NPCs or monsters, then the outcomes should be oriented to what is found rather than whether the inquiry is successful, thereby favoring discovery and moving the narrative forward. For NPCs and monsters, outcomes should still be based on the player's user input, conversation history and the game console, responding to the player as applicable while reflecting the NPCs' behavior, motivations, and context in the current room. In that vein, NPC and monster actions and dialogue must be geared towards what the player is saying and doing. Provide all potential outcomes for all characters in this single response.`;
    
    // Capture the response
    const outcomesResponse = await $.assistant.generation();
    let outcomesData = outcomesResponse.content.trim();
    
    // Step 2: Normalize character names in the response
    const normalizeCharacterName = (name) => {
        return name.replace(/[*"'`]/g, "").trim(); // Remove **, "", or other surrounding characters
    };
    
    selectedCharacters.forEach((character) => {
        const normalizedCharacter = normalizeCharacterName(character);
        const escapedCharacter = normalizedCharacter.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&"); // Escape special regex characters
        const regex = new RegExp(`-\\s*["'*]*${escapedCharacter}["'*]*:?`, "gi"); // Match the character name in various formats
        outcomesData = outcomesData.replace(regex, `- "${character}":`); // Replace with standardized format
    });
    
    console.log("Full outcomes data:", outcomesData);
    
    // Step 3: Parse outcomes for each character
    selectedCharacters.forEach((character) => {
        const characterOutcomes = [];
        // Improved regex to capture the exact block for each character
        const regex = new RegExp(
            `-\\s*"${character}":\\s*((?:\\d+\\.\\s*Dice roll range \\d+-\\d+:.*?(?:\\n|$))*)`,
            "gm"
        );
        const match = regex.exec(outcomesData);
    
        if (match) {
            const outcomeText = match[1].trim(); // The block of text for this character's outcomes
            console.log(`Outcome text for ${character}:`, outcomeText); // Debugging: Check the isolated text
    
            // Regex to extract numbered outcomes from the block
            const outcomeRegex = /(\d+)\.\s*Dice roll range (\d+)-(\d+):\s*([\s\S]*?)(?=\n\d+\.|$)/g;
            let outcomeMatch;
    
            // Iterate through all matches in the block of outcomes
            while ((outcomeMatch = outcomeRegex.exec(outcomeText)) !== null) {
                const low = parseInt(outcomeMatch[2], 10); // Start of dice roll range
                const high = parseInt(outcomeMatch[3], 10); // End of dice roll range
                const outcome = outcomeMatch[4].trim(); // Outcome description
                characterOutcomes.push({ low, high, outcome }); // Add parsed outcome to the array
            }
    
            // Validate that ranges cover the entire dice range (1-20)
            const coveredRanges = characterOutcomes.reduce(
                (acc, { low, high }) => acc + (high - low + 1),
                0
            );
            if (coveredRanges !== 20) {
                console.warn(
                    `Dice ranges for character ${character} do not cover the full range (1-20).`,
                    characterOutcomes
                );
            }
        } else {
            console.warn(`No outcomes found for character ${character}. Please validate the input.`);
        }
    
        // Add parsed outcomes to the outcomeRangesList
        outcomeRangesList.push(characterOutcomes);
    });
    
    // Step 4: Roll a 1d20 and select outcomes for each character
    selectedCharacters.forEach((character, index) => {
        const diceRoll = Math.floor(Math.random() * 20) + 1; // Roll a 1d20
        const characterOutcomes = outcomeRangesList[index]; // Get outcomes for this character
    
        // Ensure characterOutcomes exists and has entries
        if (characterOutcomes && characterOutcomes.length > 0) {
            const selectedOutcome = characterOutcomes.find(
                (range) => diceRoll >= range.low && diceRoll <= range.high
            );
    
            diceRolls.push({ character, roll: diceRoll });
            outcomes.push({
                character,
                outcome: selectedOutcome ? selectedOutcome.outcome : "No outcome available.",
            });
        } else {
            // Handle cases where no outcomes were parsed
            diceRolls.push({ character, roll: diceRoll });
            outcomes.push({
                character,
                outcome: "No outcome available.",
            });
        }
    });
    
    // Step 5: Define and pass initialOutcomes
    const initialOutcomes = {
        "Selected Characters": selectedCharacters,
        "Outcome Ranges": outcomeRangesList,
        "Dice Rolls": diceRolls,
        "Outcomes": outcomes,
    };
    
    // Log or pass initialOutcomes to the next step
    console.log("Generated Outcomes:", JSON.stringify(initialOutcomes, null, 2));
    return initialOutcomes;
    
}

async function generateAdditionalOutcomes($, initialOutcomes, updatedGameConsole, userInput) {
    if (!updatedGameConsole) {
        console.warn("No game console state provided, using default or empty values.");
        updatedGameConsole = ""; // Use default or empty values
    }

    // Parse data from updatedGameConsole
    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
    const npcsDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const monstersDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Objects in Room|Rooms Visited))/)?.[1]?.trim();

    const pcs = pcDetails ? pcDetails.split("\n").map((pc) => pc.trim()).filter((pc) => pc.length > 0) : [];
    const npcs = npcsDetails ? npcsDetails.split("\n").map((npc) => npc.trim()).filter((npc) => npc.length > 0) : [];
    const monsters = monstersDetails ? monstersDetails.split("\n").map((monster) => monster.trim()).filter((monster) => monster.length > 0) : [];

    const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
    const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);

    const currentObjects = objectsInRoomMatch ? objectsInRoomMatch[1].split(", ").map((o) => o.trim()) : [];
    const currentExits = roomExitsMatch ? roomExitsMatch[1].split(", ").map((e) => e.trim()) : [];

    const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);

    const currentCoordinates = currentCoordinatesMatch
        ? {
              x: parseInt(currentCoordinatesMatch[1]),
              y: parseInt(currentCoordinatesMatch[2]),
              z: parseInt(currentCoordinatesMatch[3]),
          }
        : { x: 0, y: 0, z: 0 }; // Default coordinates

    // Initialize variables for additional outcomes
    let new_objects = [];
    let new_exit = "";
    let xp_awarded = {};
    let trap_damage = {};
    let object_modifiers = {};
    let new_adjacent_room = {};
    let coordinates_of_connected_rooms = {};
    
    // Serialize `initialOutcomes` for inclusion in Retort prompt
    const serializedInitialOutcomes = JSON.stringify(initialOutcomes, null, 2);

    // Step 1: Use Retort to determine player intent and outcomes
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;

    $.user`Here are the current outcomes of actions by the PC, NPCs and monsters in the room: 
    ${serializedInitialOutcomes}
    Store this information in memory and await the next prompt`;
    
    await $.user`Based on the user input "${userInput}" and the game context, answer the following questions with true or false:
    1. Is the player engaged in dialogue without taking physical actions or solving a riddle? Choose True or False without resorting to randomness based on the user input and whether the player is engaged in dialogue with NPCs and/or monsters without taking any physical actions. However, if the player is speaking words, an incantation, spell or phrase required to solve the room's puzzle or riddle or game, or if the player is asking the party to take specific physical actions or speak words, an incantation, spell or phrase to solve a room's puzzle, set both engagedInDialogue and justLooking to False.
    2. Is the player simply looking, reading, deciphering, researching, investigating, or asking about objects or elements in the room without taking physical actions? Choose True or False without resorting to randomness based on the user input and whether the player is looking at, investigating, researching or reading something, or if the player is making a simple inquiry or asking a question about objects or elements of the room without taking any physical actions or solving a riddle, or if the player is asking the party to do either without taking any physical actions or solving a riddle.
    3. Did the player or NPCS attempt a search or puzzle action? Choose True or False based on the outcomes, determining whether the player is physically attempting to search the room or solve the puzzle by taking concrete actions. Mere inquiry or examination is not enough, the player has to actually do something.
    4. If the player or NPCs attempted a search or puzzle action, was it successful? Choose True or False based on the outcomes whether a search or puzzle was completed successfully? If the player is attempting to solve the puzzle, you must fully consider whether all the steps of the puzzle in Puzzle Solution: have been met. If no search or puzzle completion was attempted, or if the attempt failed, then set searchSuccessful to False.
    5. Did the outcomes of actions by the PC or NPCs state that an object or other artifact was discovered?
    6. Did the outcomes of actions by the PC or NPCs state that a new room, exit, passageway or other path was discovered?
    7. Does the puzzle solution require an exit to be created?
    8. Does the puzzle solution require an object or artifact to be discovered?`;

    const intentResponse = await $.assistant.generation({
        parameters: {
            engagedInDialogue: { type: Boolean },
            justLooking: { type: Boolean },
            searchAttempted: { type: Boolean },
            searchSuccessful: { type: Boolean },
            objectDiscovered: { type: Boolean },
            exitDiscovered: { type: Boolean },
            puzzleRequiresExit: { type: Boolean },
            puzzleRequiresObject: { type: Boolean },
        },
    });

    let {
        engagedInDialogue = false,
        justLooking = false,
        searchAttempted = false,
        searchSuccessful = false,
        objectDiscovered = false,
        exitDiscovered = false,
        puzzleRequiresExit = false,
        puzzleRequiresObject = false,
    } = intentResponse.result || {};

    console.log("Player Intent:", {
        engagedInDialogue,
        justLooking,
        searchAttempted,
        searchSuccessful,
        objectDiscovered,
        exitDiscovered,
        puzzleRequiresExit,
        puzzleRequiresObject,
    });

    // If outcomes explicitly state discovery, override search flags
    if (objectDiscovered || exitDiscovered) {
        searchAttempted = true;
        searchSuccessful = true;
        engagedInDialogue = false;
        justLooking = false;
    }

    if (puzzleRequiresExit && exitDiscovered && searchAttempted && searchSuccessful) {
        exitDiscovered = true;
    }
    
    if (puzzleRequiresObject && objectDiscovered && searchAttempted && searchSuccessful) {
        objectDiscovered = true;
    }

    // Step 2: Exit early if the player is engaged in dialogue or just looking
    if (engagedInDialogue || justLooking) {
        console.log("Player is in dialogue or just looking; skipping additional outcomes generation.");
        return {
            new_objects,
            object_modifiers,
            new_exit,
            new_adjacent_room,
            coordinates_of_connected_rooms,
            xp_awarded,
            trap_damage,
        };
    }
    
    // Step 3: Handle search or puzzle success and discoveries 
    if (searchAttempted) {
        const objectToBeDiscovered = objectDiscovered || (searchSuccessful && Math.random() < 0.4); // 40% chance or explicitly stated
        const exitToBeDiscovered = exitDiscovered || (searchSuccessful && Math.random() < 0.2); // 20% chance or explicitly stated
        const trapsPresent = !searchSuccessful && Math.random() < 0.33; // Traps are triggered if search fails
    
        console.log("Discovery Checks:", {
            objectToBeDiscovered,
            exitToBeDiscovered,
            trapsPresent,
        });

        // Generate new objects
        if (objectToBeDiscovered) {
            // Ask GPT how many objects were discovered
            await $.user`Based on the outcomes of actions, how many objects were discovered? Respond with a single integer, no additional text.`;
        
            const objectCountResponse = await $.assistant.generation();
            let numberOfObjects = parseInt(objectCountResponse.content.trim(), 10) || 1; // Default to 1 if no valid number is returned
        
            console.log(`Number of objects discovered: ${numberOfObjects}`);
        
            for (let i = 0; i < numberOfObjects; i++) {
                // Step 1: Generate the object name
                await $.user`Generate a name for a portable object suitable for a fantasy roleplaying game, as described in the outcomes of actions. The object name should be lowercased, single-line text without punctuation, and fit the game's narrative.`;
        
                const nameResponse = await $.assistant.generation();
                const objectName = nameResponse.content.trim().toLowerCase();
                console.log(`Generated object name: ${objectName}`);
        
                // Step 2: Determine the object type
                $.model = "gpt-4o-mini";
                $.temperature = 1.0;
                await $.user`Determine the type of the artifact named "${objectName}". The possible types are: weapon, armor, shield, or other. Respond with only the type.`;
        
                const typeResponse = await $.assistant.generation({
                    parameters: {
                        type: { type: String, enum: ["weapon", "armor", "shield", "other"] },
                    },
                });
        
                const objectType = (typeResponse.result?.type || "other").trim(); // Default to "other" if no valid type
                console.log(`Determined object type for ${objectName}: ${objectType}`);
        
                // Step 3: Generate modifiers for the object
                const modifiers = await generateObjectModifiers($, { name: objectName, type: objectType });
                console.log(`Generated modifiers for ${objectName}:`, modifiers);
        
                // Add the object to the outcomes
                new_objects.push(objectName);
                object_modifiers[objectName] = {
                    type: objectType,
                    ...modifiers,
                };
            }
        }
        
        // Generate a new exit
        if (exitToBeDiscovered) {
            await $.user`Create a name for a newly discovered room connected to the current room. The name should reflect the narrative and lore of the game. Respond with just the name.`;

            const roomNameResponse = await $.assistant.generation();
            const newRoomName = roomNameResponse.content.trim();

            if (newRoomName) {
                const possibleExits = [
                    "north",
                    "south",
                    "east",
                    "west",
                    "northeast",
                    "southeast",
                    "northwest",
                    "southwest",
                    "up",
                    "down",
                ];
                for (const exit of possibleExits) {
                    if (!currentExits.includes(exit)) {
                        new_exit = exit;
                        const directionMap = {
                            north: { x: 0, y: 1, z: 0 },
                            south: { x: 0, y: -1, z: 0 },
                            east: { x: 1, y: 0, z: 0 },
                            west: { x: -1, y: 0, z: 0 },
                            northeast: { x: 1, y: 1, z: 0 },
                            southeast: { x: 1, y: -1, z: 0 },
                            northwest: { x: -1, y: 1, z: 0 },
                            southwest: { x: -1, y: -1, z: 0 },
                            up: { x: 0, y: 0, z: 1 },
                            down: { x: 0, y: 0, z: -1 },
                        };
                        const coordChange = directionMap[exit];
                        coordinates_of_connected_rooms = {
                            x: currentCoordinates.x + coordChange.x,
                            y: currentCoordinates.y + coordChange.y,
                            z: currentCoordinates.z + coordChange.z,
                        };
                        new_adjacent_room = {
                            name: newRoomName,
                            description: `A newly discovered room to the ${exit}.`,
                        };
                        break;
                    }
                }
            }
        }

        // Apply trap damage to PCs and NPCs only
        if (trapsPresent) {
            const charactersToDamage = [...pcs, ...npcs];
            for (const character of charactersToDamage) {
                trap_damage[character] = (trap_damage[character] || 0) + Math.floor(Math.random() * 7) + 1; // 1-7 damage
            }
        }
    }

    // Step 4: Award XP for PCs and NPCs only
    const xpEligibleCharacters = [...pcs, ...npcs];
    await $.user`For the following characters: ${xpEligibleCharacters.join(", ")}, decide which characters deserve XP based on their actions in the initial outcomes, and assign up to 500 XP to each deserving character. Respond with a JSON object mapping character names to their XP.`;

    const xpResponse = await $.assistant.generation();
    xp_awarded = JSON.parse(xpResponse.content.trim() || "{}");

    // Final result object
    const result = {
        new_objects,
        object_modifiers,
        new_exit,
        new_adjacent_room,
        coordinates_of_connected_rooms,
        xp_awarded,
        trap_damage,
    };

    console.log("Generated Additional Outcomes:", JSON.stringify(result, null, 2));
    return result;
}

async function generateAdditionalOutcomesPython($, initialOutcomes, updatedGameConsole, userInput, errorLogs = '') {
    const errorLogSection = errorLogs && errorLogs.trim()
        ? `\n\n### Error Logs from Previous Attempts ###\n${errorLogs.trim()}`
        : 'No previous errors detected.';
    console.log("Error Logs Passed to RegenerateCallback:", errorLogs);
    // Parse data from updatedGameConsole
    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
    const npcsDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
    const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);

    const currentObjects = objectsInRoomMatch ? objectsInRoomMatch[1].split(", ").map(o => o.trim()) : [];
    const currentExits = roomExitsMatch ? roomExitsMatch[1].split(", ").map(e => e.trim()) : [];
    
    const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);

    const currentCoordinates = {
        x: parseInt(currentCoordinatesMatch[1]),
        y: parseInt(currentCoordinatesMatch[2]),
        z: parseInt(currentCoordinatesMatch[3])
    };
    const sanitizeJSON = (jsonString) => {
        try {
            // Ensure valid JSON by parsing and re-stringifying
            return JSON.stringify(JSON.parse(jsonString)); // Avoid unnecessary extra escaping
        } catch (e) {
            console.error("Invalid JSON string:", jsonString, e.message);
            throw new Error("Invalid JSON detected");
        }
    };
    
    // Serialize and sanitize data into JSON strings
    const outcomesJson = sanitizeJSON(JSON.stringify(initialOutcomes));
    const currentObjectsJson = sanitizeJSON(JSON.stringify(currentObjects));
    const currentExitsJson = sanitizeJSON(JSON.stringify(currentExits));
    const currentCoordinatesJson = sanitizeJSON(JSON.stringify(currentCoordinates));
    
    // Escape user input specifically for Python raw strings
    const userInputJson = `r'''${userInput}'''`;
    
    // Python script generation
    const pythonScript = `
    import json
    import random
    import sys
    
    outcomes_json = r'''${outcomesJson}'''
    current_objects_json = r'''${currentObjectsJson}'''
    current_exits_json = r'''${currentExitsJson}'''
    current_coordinates_json = r'''${currentCoordinatesJson}'''
    user_input_json = ${userInputJson}
        
    try:
        print(f"Debug: outcomes_json = {outcomes_json}", file=sys.stderr)
        outcomes = json.loads(outcomes_json)
    
        print(f"Debug: current_objects_json = {current_objects_json}", file=sys.stderr)
        current_objects = json.loads(current_objects_json)
    
        print(f"Debug: current_exits_json = {current_exits_json}", file=sys.stderr)
        current_exits = json.loads(current_exits_json)
    
        print(f"Debug: current_coordinates_json = {current_coordinates_json}", file=sys.stderr)
        current_coordinates = json.loads(current_coordinates_json)
    
        print(f"Debug: user_input_json = {user_input_json}", file=sys.stderr)
        userInput = user_input_json
        
        # Initialize variables for new game elements
        new_objects = []
        new_exit = ""
        xp_awarded = {}
        trap_damage = {}
        object_modifiers = {}
        new_adjacent_room = {}
        coordinates_of_connected_rooms = {}
        
        # Determine if the player is engaged in dialogue without taking any physical actions or solving a riddle based on the user input. 
        # However, if the player is speaking words, an incantation, spell or phrase required to solve the room's puzzle or riddle or game, or if the player is asking the party to take specific physical actions or speak words, an incantation, spell or phrase to solve a room's puzzle, set both is_player_in_dialogue and is_player_just_looking to False and proceed to the next step. 
        is_player_in_dialogue = # Choose True or False without resorting to randomness based on the user input and whether the player is engaged in dialogue with NPCs and/or monsters without taking any physical actions. However, if the player is speaking words, an incantation, spell or phrase required to solve the room's puzzle or riddle or game, or if the player is asking the party to take specific physical actions or speak words, an incantation, spell or phrase to solve a room's puzzle, set both is_player_in_dialogue and is_player_just_looking to False
        # Determine if the player is looking at, investigating, researching or reading something, or if the player is making a simple inquiry or asking a question about objects or elements of the room, or if the player is asking the party to either so without taking any physical actions based on the user input
        is_player_just_looking = # Choose True or False without resorting to randomness based on the user input and whether the player is looking at, investigating, researching or reading something, or if the player is making a simple inquiry or asking a question about objects or elements of the room without taking any physical actions or solving a riddle, or if the player is asking the party to do either without taking any physical actions or solving a riddle

        # If the player is engaged in dialogue or just looking based on the user prompt, skip further processing and output only initial outcomes
        if is_player_in_dialogue or is_player_just_looking:
            result = {
                "new_objects": [],
                "object_modifiers": {},
                "new_exit": "",
                "new_adjacent_room": {},
                "coordinates_of_connected_rooms": {},
                "xp_awarded": {},
                "trap_damage": {},
            }
        print(json.dumps(result, default=str).replace('"None"', 'null').strip())
        sys.exit(0)  # Exit early since no additional processing is required
    
        # Define possible object types
        possible_object_types = ["weapon", "armor", "shield", "other"]
        
        # Based on the outcomes, determine whether the player is physically attempting to search the room or solve the puzzle by taking concrete actions. Mere inquiry or examination is not enough, the player has to actually do something.
        search_or_puzzle_was_attempted = # Choose True or False without resorting to randomness based on the outcomes
        # Based on the outcomes, if a search or puzzle completion was attempted, was completed it successfully? If the player is attempting to solve the puzzle, you must fully consider whether all the steps of the puzzle in Puzzle Solution: have been met. If no search or puzzle completion was attempted, or if the attempt failed, then set search_or_puzzle_successful to False.
        search_or_puzzle_successful = # Choose True or False without resorting to randomness based on the outcomes
        object_to_be_discovered = random.random() < 0.4 # 40% chance for objects UNLESS outcomes specifically state there was an object discovered in which case change to 100%
        print(f"Object Discovery Check: {object_to_be_discovered}", file=sys.stderr)
        exit_to_be_discovered = random.random() < 0.2 # 20% chance for exits UNLESS outcomes specifically stated there was an exit, passage, door or some other cooridor found in which case change to 100% 
        print(f"Exit Discovery Check: {exit_to_be_discovered}", file=sys.stderr)
        traps_present = random.random() < 0.33 # 33% chance for traps UNLESSS outcomes specifically stated there was a trap triggered then change to 100%
        print(f"Traps Present Check: {traps_present}", file=sys.stderr)

        # Generate new objects potentially if a successful "search" action occurs, or if a monster in the room produces a new item, or if a successfully solved puzzle called for new objects to be produced
        if search_or_puzzle_was_attempted and search_or_puzzle_successful:
            # Generate new object
            if object_to_be_discovered:
                num_objects_to_create = # Set to 1, 2, 3, etc. based on outcomes if more than one object was discovered else default to 1
                for i in range(num_objects_to_create):
                    new_object_name = f"" # Dynamically generate object name (e.g., based on the action, outcomes or context)
                    if new_object_name.lower() not in [obj.lower() for obj in current_objects]:  # Check for uniqueness
                        current_objects.append(new_object_name)  # Add to current objects to avoid duplicates
                        new_objects.append(new_object_name)
                        object_type = ""  # Assign an object type from possible_object_types = "weapon", "armor", "shield", "other"
                        object_modifiers[new_object_name] = {
                            "type": object_type,
                            "attack_modifier": 0, # Choose a number between 0 and 3
                            "damage_modifier": 0, # Choose a number between 0 and 3
                            "ac": 0, # Choose a number between 0 and 3
                            "magic": 0, # Choose a number between 0 and 3
                        }
                    print(f"Debug: New object created: {new_object_name} with type {object_type} and modifiers {object_modifiers[new_object_name]}", file=sys.stderr)
    
            # Map directions to coordinate changes
            direction_map = {
                "north": (0,1,0),
                "south": (0,-1,0),
                "east": (1,0,0),
                "west": (-1,0,0),
                "northeast": (1,1,0),
                "northwest": (-1,1,0),
                "southeast": (1,-1,0),
                "southwest": (-1,-1,0),
                "up": (0,0,1),
                "down": (0,0,-1),
            }
        
            # Add a new exit if a successful "search" action occurs, or if a successfully solved puzzle called for a new room, chamber, passageway or exit to be produced
            if exit_to_be_discovered and not new_exit:
                possible_exits = list(direction_map.keys())
                for exit_option in possible_exits:
                    if exit_option not in current_exits:
                        new_exit = exit_option
                        coord_change = direction_map[new_exit]
                        new_coords = {
                            "x": current_coordinates["x"] + coord_change[0],
                            "y": current_coordinates["y"] + coord_change[1],
                            "z": current_coordinates["z"] + coord_change[2]
                        }
                        coordinates_of_connected_rooms = new_coords
                        new_adjacent_room = {
                            "name": f"", # Generate a unique name and nothing else with no punctuation or description, just the name, for a room connected to the current room taking into account the conversation history, the current location and coordinates in the game console, the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore, using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. 
                            "description": f"A newly discovered room to the {new_exit}.",
                        }
                        coordinates_of_connected_rooms = new_coords
                        print(f"Debug: New exit added: {new_exit}, coordinates: {new_coords}", file=sys.stderr)
                        break

        # Logic to determine additional outcomes
        for outcome in outcomes.get("Outcomes", []):
            # Ensure character is always a string and not empty
            character = str(outcome.get("character", "Unknown")).strip()
            if not character:
                raise ValueError("Invalid or missing character name in outcomes")
        
            action = outcome.get("outcome", "").lower()
            if not isinstance(action, str):
                raise ValueError(f"Invalid action for character {character}: {action}")
        
            print(f"Debug: Processing action for {character}: {action}", file=sys.stderr)
            
            any_action_successful = # Choose True or False without resorting to randomness based on outcomes and whether an action was successful

            # Apply trap damage potentially and only if there are traps in the room AND a puzzle is not solved correctly or if a room is searched without disarming those traps
            # If search or puzzle action was not successful and traps are present
            if search_or_puzzle_was_attempted and not search_or_puzzle_successful and traps_present:
                    trap_damage[character] = trap_damage.get(character, 0) + 0 # Choose how much HP damage to inflict, up to 7 HP
                    print(f"Debug: Trap damage applied to {character}: {trap_damage[character]}", file=sys.stderr)

            # Award XP for any other successful action
            if any_action_successful or search_or_puzzle_successful:
                xp_awarded[character] = xp_awarded.get(character, 0) + 0  # Assign XP for general success up to 500 XP
                print(f"Debug: XP awarded to {character} for general success: {xp_awarded[character]}", file=sys.stderr)
    
        # Construct result JSON
        result = {
            "new_objects": new_objects,
            "object_modifiers": object_modifiers,
            "new_exit": new_exit,
            "new_adjacent_room": new_adjacent_room,
            "coordinates_of_connected_rooms": coordinates_of_connected_rooms,
            "xp_awarded": xp_awarded,
            "trap_damage": trap_damage,
        }
    
        # Output result
        print(json.dumps(result, default=str).replace('"None"', 'null').strip())
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    `;
    
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    await $.user`Generate a Python script to analyze outcomes from an initial simulation, the current game state, and determine additional game elements dynamically. Use the following parameters:
    
    1. **Initial Outcomes**: ${outcomesJson} - The outcomes from the initial simulation.
    2. **Current Objects in Room**: ${currentObjectsJson} - The objects already present in the room.
    3. **Current Exits in Room**: ${currentExitsJson} - The available exits in the room.
    4. **Current Coordinates of Room**: ${currentCoordinatesJson} - The current coordinates of the current room.
    5. **User Input**: ${userInputJson} - The player action being adjudicated.

    The Python script should:
    - Parse the initial outcomes to determine character actions (e.g., search, explore, success, or trap).
    - Determine if the player is in dialogue without taking any physical actions based on the user input. If dialogue is occurring that does not include physical actions, exit the function early.
    - Determine iif the player is looking at, investigating, researching or reading something, or if the player is making a simple inquiry or asking a question about objects or elements of the room, or if the player is asking the party to either so that does not include physical actions based on the user input. If so, exit the function early.
    - Determine if the player is speaking words, an incantation, spell or phrase required to solve the room's puzzle or riddle or game, or if the player is asking the party to take specific physical actions or speak words, an incantation, spell or phrase to solve a room's puzzle. If so set both is_player_in_dialogue and is_player_just_looking to False and proceed to the next step. 
    - Determine if there are any new objects, exits or traps in the room by outputting all print statements included in the template, including object_to_be_discovered, exit_to_be_discovered and traps_present that determine whether there are objects, exits or traps, to ensure functionality. Use the probabilities presented UNLESS the outcomes specifically state there was an object or exit discovered or trap triggered in which case change probability for the applicable variable to 100%.
    - Determine whether the player is attempting to physically search the room or solve the puzzle and if so, was the search or puzzle successfully solved, fully considering whether all the steps of the puzzle in Puzzle Solution: have been met. If not, then set search_or_puzzle_successful to False.
    - Generate new objects if a successful "search" actions occur or a puzzle is solved that called for new object(s) to be produced, ensuring unique names and assigning appropriate modifiers (attack_modifier, damage_modifier, ac, and magic) between 0-3.
    - Add a new exit if a successful "search" action occurs or a puzzle is solved, selecting from ["north", "south", "east", "west", "northwest", "southwest", "northeast", "southeast", "up", "down"] while avoiding duplicates from existing exits. If there is a new exit, you also must generate a name for the new room that the new exit leads to and calculate its coordinates relative to the current room's coordinates. 
    - Award XP (up to 500 points) for "success" actions, tracking by character.
    - Apply trap damage (up to 7 points) for "trap" actions, reducing the HP of affected characters.

    The script should output a JSON object containing:
    - new_objects: List of newly created objects.
    - object_modifiers: A dictionary mapping new object names to their modifiers.
    - new_exit: A single new exit, if applicable.
    - xp_awarded: A dictionary mapping characters to their awarded XP.
    - trap_damage: A dictionary mapping characters to the damage inflicted.

    Execute the following Python code to roll and select the outcomes:

    ${pythonScript}
    
    Only include the Python code to be executed in the exact code structure stipulated so that the Linux server can process it as is without any syntax or non-zero errors as plain text without the python specifier and removing any backticks from the script output, print the final JSON object to stdout with no other words like Generated Python Code: or backticks or quotes wrapping the code or anything else whatsoever, just the code with any new objects, object modifiers, exits, XP awarded and/or trap damage included. Stick to the format provided. Don't modify the user input. No backticks!
    
    ${errorLogSection}`;
    
    const pythonCode = (await $.assistant.generation()).content;
    console.log("Generated Python Code:", pythonCode);
    return pythonCode;
}

async function generatePythonCode($, userInput, updatedGameConsole, errorLogs = '') {
    const errorLogSection = errorLogs && errorLogs.trim()
        ? `\n\n### Error Logs from Previous Attempts ###\n${errorLogs.trim()}`
        : 'No previous errors detected.';
    console.log("Error Logs Passed to RegenerateCallback:", errorLogs);
    if (!updatedGameConsole) {
        console.warn("No game console state provided, using default or empty values.");
        updatedGameConsole = "";  // Or some default game console state
    }

       // Extract PC details from the updatedGameConsole
        const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party))/);
        const npcsDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room))/);
        const monstersDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties))/);
        
        // Parse PCs
        let pcs = [];
        if (pcDetails) {
            let pcSection = pcDetails[1].trim();
            let pcLines = pcSection.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (pcLines.length > 0 && pcLines[0] !== 'None') {
                pcs.push(pcLines[0]); // First line is the character name
            }
        }

        // Parse NPCs
        let npcs = [];
        if (npcsDetails) {
            let npcsSection = npcsDetails[1].trim();
            let lines = npcsSection.split('\n').map(line => line.trimRight());
            for (let line of lines) {
                if (line.trim().length === 0) {
                    continue; // Skip empty lines
                }
                if (!line.startsWith(' ') && !line.startsWith('\t')) {
                    if (line !== 'None') {
                        npcs.push(line.trim());
                    }
                }
            }
        }

        // Parse Monsters
        let monsters = [];
        if (monstersDetails) {
            let monstersSection = monstersDetails[1].trim();
            let lines = monstersSection.split('\n').map(line => line.trimRight());
            for (let line of lines) {
                if (line.trim().length === 0) {
                    continue; // Skip empty lines
                }
                if (!line.startsWith(' ') && !line.startsWith('\t')) {
                    if (line !== 'None') {
                        monsters.push(line.trim());
                    }
                }
            }
        }

        // Serialize the arrays into JSON strings
        const pcsJson = JSON.stringify(pcs);
        const npcsJson = JSON.stringify(npcs);
        const monstersJson = JSON.stringify(monsters); 

    const pythonScript = `
    import json
    import random
    import sys
    
    # Deserialize the JSON strings into Python lists
    pcs = json.loads('''${pcsJson}''')
    npcs = json.loads('''${npcsJson}''')
    monsters = json.loads('''${monstersJson}''')
    
    try:
        # Logging to stderr for debug purposes
        print(f"PCs: {pcs}, NPCs: {npcs}, Monsters: {monsters}", file=sys.stderr)
    
        # Combine all characters into a single list
        selected_characters = pcs + npcs + monsters
        if not selected_characters:
            raise ValueError("No characters were selected for the dice roll.")
    
        print(f"Selected characters: {selected_characters}", file=sys.stderr)
    
        # Store dice rolls and outcomes
        dice_rolls = []
        outcomes = []
        outcome_ranges_list = []
    
        # Determine the number of dice rolls based on the current circumstances and in part by number of characters, creating 2 to 6 narrative-rich potential outcomes unique to each character based on the game context, but for the PC you must adjudicate the user input that always includes the player's action. 
        for character in selected_characters:
            num_outcomes = # Always choose how many potential outcomes there are for num_outcomes for each character, between 2 to 6 potential outcomes. 
            outcome_ranges = [] # Create between 2 to 6 potential outcomes that are unique for each character based on the current circumstances in the game including the user input and the game console. If the player is making a simple inquiry asking about objects or for more details about something or engaged in dialogue with NPCs or monsters, then the outcomes should be oriented to what is found rather than whether the inquiry is successful, thereby favoring discovery and moving the narrative forward. If the player figures out the precise solution to the puzzle, then increase chance of success to 95+%. 
            if num_outcomes < 2:
                num_outcomes = random.randint(2, 6)
            step = 20 // num_outcomes
            for j in range(num_outcomes):
                low = j * step + 1
                high = (j + 1) * step if j < num_outcomes - 1 else 20
                outcome = f"{character} performs an action based on roll range {low}-{high}." # 
                outcome_ranges.append((low, high, outcome))
            outcome_ranges_list.append(outcome_ranges)
    
            # Roll the dice for this character
            dice_roll = random.randint(1, 20)
            dice_rolls.append({"character": character, "roll": dice_roll})
            selected_outcome = next((outcome for low, high, outcome in outcome_ranges if low <= dice_roll <= high), None)
            else:
                selected_outcome = None
                print(f"Warning: No outcome ranges generated for {character}", file=sys.stderr)

            outcomes.append({"character": character, "outcome": selected_outcome})
    
        # Final structured result
        result = {
            "Selected Characters": selected_characters,
            "Outcome Ranges": outcome_ranges_list,
            "Dice Rolls": dice_rolls,
            "Outcomes": outcomes
        }
    
        # Print the JSON result to stdout
        print(json.dumps(result))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
`;

    $.model = "gpt-4o-mini";
    $.temperature = 1.0;

    await $.user`Generate a Python script that simulates dice rolls for the following characters to determine outcomes based on the player's user input and their actions in a fantasy RPG context. Use these JSON strings for parsing:

    PCs: ${pcsJson}
    NPCs: ${npcsJson}
    Monsters: ${monstersJson}
    
    Here is the player action to adjudicate as the top priority based on the current game state:\nUser Input:\n${userInput.trim()}

    The script should:
    - Deserialize these JSON strings into lists for PCs, NPCs, and Monsters.
    - Arbitrarily decide the number of potential outcomes (between 2 and 6) for each character before writing the Python code.
    - Generate **2-6 unique potential outcomes** for each character. Each potential outcome must be based on the user input, conversation history, and game console and be distinct and contextually relevant in a way that resolves the player's user input as the top priority. For the PC (player character), outcomes must directly adjudicate the player's action as stated in the user input. If the player is making a simple inquiry asking about objects or for more details about something or engaged in dialogue with NPCs or monsters, then the outcomes should be oriented to what is discovered. For NPCs and monsters, outcomes should still be based on the player's user input, conversation history and the game console, responding to the player as applicable while reflecting the NPCs' behavior, motivations, and context in the current room. In that vein, NPC and monster actions and dialogue must be geared towards what the player is saying and doing.
    - Assign **different narrative consequences** for each die roll range (e.g., 1-5, 6-10, etc.) per character, ensuring a variety of potential outcomes per character. Avoids repetition of the same outcome for all ranges. Each potential outcome for each die roll range must be unique!
    - If the player is attempting to search the room or solve the puzzle, the potential outcomes should fully consider whether all the steps of the puzzle in Puzzle Solution: have been met or if there obstacles to the search or not. Success or failure should be an option. 
    - Roll a 1d20 die and select an outcome for each character based on the roll.
    - Print the outcomes in JSON format, where each outcome includes the character name, the roll, and the narrative consequence of that roll.

    The Python code should handle exceptions and log errors, including making certain to include error handling for NameError, ValueError, and any other exceptions, printing detailed error messages to stderr or stdout for debugging purposes. 
    
    Based on the provided user input, the conversation history and the current game console, adjudicate the player's actions. Consider NPCs in the party, monsters in the room, and environmental elements in the game console when generating potential outcomes, but do not generate any new NPCs, monsters, objects or exits in the room. Instead, only reference the NPCs, monsters, objects and exits from the game console. Take no actions on behalf of the PC if not stated in the user prompt but it is ok to create actions for any NPCs or monsters in the room, especially those that respond to the player.
                
    Create between 2-6 possible, unique outcomes per character dynamically, with each outcome having a different narrative consequence by assigning a reasonable probability to an event, weighting the dice as necessary to give an an advantage or disadvantage given the circumstances and to prevent cheating if a character attempts to do something that is simply impossible. If the player directly interacts with the NPCs in the party and/or the monsters in the room, include the potential outcomes of the interaction. Do not ask for more details or clarification. Use the provided input and game state to determine everything necessary.

    For each outcome, decide the dice roll ranges that apply for each of the 2-6 potential outcomes per character, based on what would make the story more interesting. Then roll a dice and select the outcome based on the ranges you have generated.
    
    Execute the following Python code to roll and select the outcomes:

    ${pythonScript}
    
    Only include the Python code to be executed as plain text without the python specifier and removing any backticks from the script output, with no other words like Generated Python Code: or backticks or quotes wrapping the code or anything else whatsoever, just the code with the dice ranges and potential outcomes included in the exact code structure stipulated so that the Linux server can process it as is without any syntax or non-zero errors. Stick to the format provided. No backticks!
    
    ${errorLogSection}`;

    const pythonCode = (await $.assistant.generation()).content;
    console.log("Generated Python Code:", pythonCode);
    return pythonCode;
}

async function adjudicateActionWithSimulation($, userInput, updatedGameConsole, maxRetries = 3, delayMs = 1000) {
    let attempt = 0;
    let initialOutcomes = null;

    while (attempt < maxRetries) {
        try {
            console.log(`Adjudication Process Attempt: ${attempt + 1}/${maxRetries}`);
            console.log("User Input:", userInput);
            console.log("Initial Game Console State:", updatedGameConsole);

            // Step 1: Generate initial outcomes
            console.log("Generating outcomes...");
            const outcomesResult = await generateOutcomes($, userInput, updatedGameConsole);

            // Validate outcomes result
            if (outcomesResult.error) {
                console.error("Error generating outcomes:", outcomesResult.error);
                throw new Error("Outcome generation failed");
            }

            console.log("Generated Outcomes:", outcomesResult);

            // Assign `outcomesResult` to `initialOutcomes`
            initialOutcomes = outcomesResult;
            console.log("Parsed Initial Outcomes:", initialOutcomes);

            // Ensure `initialOutcomes` exists before proceeding
            if (!initialOutcomes) {
                throw new Error("initialOutcomes is undefined. Cannot proceed with adjudication.");
            }

            // Step 2: Generate additional outcomes using `generateAdditionalOutcomes`
            console.log("Generating additional outcomes...");
            const additionalOutcomes = await generateAdditionalOutcomes($, initialOutcomes, updatedGameConsole, userInput);

            console.log("Generated Additional Outcomes:", additionalOutcomes);

            // Step 3: Update the game console using `processGameUpdate`
            console.log("Updating Game Console...");
            const gameUpdateResult = processGameUpdate(additionalOutcomes, updatedGameConsole);
            console.log("Updated Game Console:", gameUpdateResult);

            // Step 4: Generate the narrative
            console.log("Generating Narrative...");
            const narrative = generateNarrative(initialOutcomes, additionalOutcomes, userInput);
            console.log("Generated Narrative:", narrative);

            return { narrative, updatedGameConsole: gameUpdateResult };
        } catch (error) {
            console.error(`Error on attempt ${attempt + 1}: ${error.message}`);
            if (attempt + 1 < maxRetries) {
                console.log(`Retrying after ${delayMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            } else {
                console.error("Maximum retries reached. Failing the adjudication process.");
                throw new Error("Adjudication process failed after maximum retries.");
            }
        }
        attempt++;
    }
}

async function adjudicateActionWithPythonSimulation($, userInput, updatedGameConsole, maxRetries = 3, delayMs = 1000) {
    let attempt = 0;
    let initialOutcomes = null; // Ensure `initialOutcomes` is defined in the outer scope

    while (attempt < maxRetries) {
        try {
            console.log(`Adjudication Process Attempt: ${attempt + 1}/${maxRetries}`);
            console.log("User Input:", userInput);
            console.log("Initial Game Console State:", updatedGameConsole);

            try {
                // Step 1: Generate outcomes directly using JavaScript and Retort
                console.log("Generating outcomes...");
                const outcomesResult = await generateOutcomes($, userInput, updatedGameConsole);

                // Validate outcomes result
                if (outcomesResult.error) {
                    console.error("Error generating outcomes:", outcomesResult.error);
                    throw new Error("Outcome generation failed");
                }

                console.log("Generated Outcomes:", outcomesResult);

                // Parse the outcomes into `initialOutcomes` format
                initialOutcomes = outcomesResult; // Assign directly, as `outcomesResult` is already in the expected format
                console.log("Parsed Initial Outcomes:", initialOutcomes);

            } catch (error) {
                console.error("Failed to generate or parse outcomes:", error.message);
                throw new Error("Failed to generate or parse outcomes");
            }

            // Ensure `initialOutcomes` exists before proceeding
            if (!initialOutcomes) {
                throw new Error("initialOutcomes is undefined. Cannot proceed with adjudication.");
            }

            // Step 2: Generate and execute the second Python script
            const additionalPythonCode = await generateAdditionalOutcomesPython(
                $, 
                initialOutcomes, 
                updatedGameConsole, 
                userInput, 
                (errorLogs = "")
            );
            console.log("Generated Additional Python Code:", additionalPythonCode);

            const additionalPythonOutput = await executePython(additionalPythonCode, 10, 1000, async () => {
                console.log("Regenerating additional Python script...");
                return await generateAdditionalOutcomesPython(
                    $, 
                    initialOutcomes, 
                    updatedGameConsole, 
                    userInput, 
                    (errorLogs = "")
                );
            });
            console.log("Additional Python Output:", additionalPythonOutput);

            // Parse the additional outcomes
            let additionalOutcomes;
            try {
                additionalOutcomes = JSON.parse(additionalPythonOutput.trim());
                console.log("Parsed Additional Outcomes:", additionalOutcomes);
            } catch (error) {
                console.error("Error parsing additional Python output:", error.message);
                console.log("Raw Additional Output for Debugging:", additionalPythonOutput);
                throw new Error("Failed to parse additional Python output");
            }

            // Step 3: Update the game console using `processGameUpdate`
            console.log("Updating Game Console...");
            const gameUpdateResult = processGameUpdate(additionalOutcomes, updatedGameConsole);
            console.log("Updated Game Console:", gameUpdateResult);

            // Step 4: Generate the narrative
            console.log("Generating Narrative...");
            const narrative = generateNarrative(initialOutcomes, additionalOutcomes, userInput);
            console.log("Generated Narrative:", narrative);

            return { narrative, updatedGameConsole: gameUpdateResult };
        } catch (error) {
            console.error(`Error on attempt ${attempt + 1}: ${error.message}`);
            if (attempt + 1 < maxRetries) {
                console.log(`Retrying after ${delayMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            } else {
                console.error("Maximum retries reached. Failing the adjudication process.");
                throw new Error("Adjudication process failed after maximum retries.");
            }
        }
        attempt++;
    }
}

function processGameUpdate(additionalOutcomes, updatedGameConsole) {
    if (!updatedGameConsole || typeof updatedGameConsole !== "string") {
        throw new Error("Invalid or missing updatedGameConsole input.");
    }

    if (!additionalOutcomes || typeof additionalOutcomes !== "object") {
        console.error("Invalid additionalOutcomes:", additionalOutcomes);
        throw new Error("Invalid additionalOutcomes object.");
    }

    console.log("processGameUpdate - Starting with additionalOutcomes:", additionalOutcomes);
    console.log("processGameUpdate - Current Game Console State:", updatedGameConsole);

    const {
        new_objects = [],
        object_modifiers = {},
        new_exit = "",
        new_adjacent_room = {},
        coordinates_of_connected_rooms = {},
        xp_awarded = {},
        trap_damage = {},
    } = additionalOutcomes;

    let needsUpdate = false; // Flag to track if updates are made

    // Extract existing objects and properties
    const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
    let currentObjects = objectsInRoomMatch?.[1]?.split(", ").map(o => o.trim()) || [];
    
    // Handle "None" in current objects
    if (currentObjects.length === 1 && currentObjects[0] === "None") {
        currentObjects = [];
    }

    const objectPropertiesMatch = updatedGameConsole.match(/Objects in Room Properties: ([^\n]+)/);

    let currentProperties = [];
    if (objectPropertiesMatch && objectPropertiesMatch[1] !== "None") {
        currentProperties = objectPropertiesMatch[1]
            .split("}, {")
            .map(str => `{${str.replace(/[{}]/g, "").trim()}}`)
            .map(entry => {
                const pairs = entry.replace(/[{}]/g, "").split(", ").map(pair => pair.split(": ").map(p => p.trim()));
                return Object.fromEntries(
                    pairs.map(([key, value]) => [
                        key.replace(/"/g, ""),
                        isNaN(value) ? value.replace(/"/g, "") : Number(value),
                    ])
                );
            });
    }

    // Add new objects and update properties
    new_objects.forEach(object => {
        const lowerCaseObject = object.toLowerCase(); // Convert the object name to lowercase
        if (!currentObjects.includes(lowerCaseObject)) {
            currentObjects.push(lowerCaseObject);

            const modifiers = object_modifiers[object] || {
                type: "other",
                attack_modifier: 0,
                damage_modifier: 0,
                ac: 0,
                magic: 0,
            };

            currentProperties.push({
                name: lowerCaseObject,
                type: modifiers.type,
                attack_modifier: modifiers.attack_modifier,
                damage_modifier: modifiers.damage_modifier,
                ac: modifiers.ac,
                magic: modifiers.magic,
            });

            needsUpdate = true; // Mark that an update was made
        }
    });

    // Determine if properties should be updated
    const formattedProperties =
        currentProperties.length > 0
            ? currentProperties
                  .map(
                      prop =>
                          `{name: "${prop.name}", type: "${prop.type}", attack_modifier: ${prop.attack_modifier}, damage_modifier: ${prop.damage_modifier}, ac: ${prop.ac}, magic: ${prop.magic}}`
                  )
                  .join(", ")
            : "None";

    // Update the game console with new objects and properties
    updatedGameConsole = updatedGameConsole.replace(
        /Objects in Room: [^\n]*/,
        `Objects in Room: ${currentObjects.length > 0 ? currentObjects.join(", ") : "None"}`
    );

    updatedGameConsole = updatedGameConsole.replace(
        /Objects in Room Properties: [^\n]*/,
        `Objects in Room Properties: ${formattedProperties}`
    );

    // Update room exits
    const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);
    const currentExits = roomExitsMatch ? roomExitsMatch[1].split(", ").map(e => e.trim()) : [];
    if (new_exit) {
        if (!currentExits.includes(new_exit)) {
            currentExits.push(new_exit);
            updatedGameConsole = updatedGameConsole.replace(/Exits: [^\n]*/, `Exits: ${currentExits.join(", ")}`);
            needsUpdate = true;
        }

        const adjacentRoomsMatch = updatedGameConsole.match(/Adjacent Rooms: ([^\n]+)/);
        const currentAdjacentRooms = adjacentRoomsMatch
            ? adjacentRoomsMatch[1].split(", ").map(a => a.trim())
            : [];
        const newAdjacentRoomEntry = `${new_exit}: ${new_adjacent_room.name}`;

        if (!currentAdjacentRooms.includes(newAdjacentRoomEntry)) {
            currentAdjacentRooms.push(newAdjacentRoomEntry);
            updatedGameConsole = updatedGameConsole.replace(
                /Adjacent Rooms: [^\n]*/,
                `Adjacent Rooms: ${currentAdjacentRooms.join(", ")}`
            );
        }

        const coordinatesMatch = updatedGameConsole.match(/Coordinates of Connected Rooms: ([^\n]+)/);
        const currentCoordinates = coordinatesMatch
            ? coordinatesMatch[1].split(";").map(coord => coord.trim())
            : [];

        const newCoordinates = `${coordinates_of_connected_rooms.x},${coordinates_of_connected_rooms.y},${coordinates_of_connected_rooms.z}`;

        if (!currentCoordinates.includes(newCoordinates)) {
            currentCoordinates.push(newCoordinates);
            updatedGameConsole = updatedGameConsole.replace(
                /Coordinates of Connected Rooms: [^\n]*/,
                `Coordinates of Connected Rooms: ${currentCoordinates.join("; ")}`
            );
        }
    }

    // Apply XP awards
    Object.entries(xp_awarded).forEach(([character, xp]) => {
        const xpRegex = new RegExp(`(${character}.*?XP:\\s*)(\\d+)`, "s");
        updatedGameConsole = updatedGameConsole.replace(xpRegex, (match, prefix, currentXp) => {
            const newXp = parseInt(currentXp, 10) + xp;
            return `${prefix}${newXp}`;
        });
        needsUpdate = true; // Mark that an update was made
    });

    // Apply trap damage
    Object.entries(trap_damage).forEach(([character, damage]) => {
        const hpRegex = new RegExp(`(${character}.*?HP:\\s*)(\\d+)`, "s");
        updatedGameConsole = updatedGameConsole.replace(hpRegex, (match, prefix, currentHp) => {
            const newHp = Math.max(parseInt(currentHp, 10) - damage, 0); // Ensure HP doesn't go below 0
            return `${prefix}${newHp}`;
        });
        needsUpdate = true; // Mark that an update was made
    });

    // Save the updated console state if there are changes
    if (needsUpdate) {
        sharedState.setUpdatedGameConsole(updatedGameConsole);
    }

    console.log("Updated Game Console:", updatedGameConsole);
    return updatedGameConsole;
}

async function adjudicateActionWithCodeInterpreter(userInput, updatedGameConsole) {
    try {
        // Extract PC details from the updatedGameConsole
        const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party))/);
        const npcsDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room))/);
        const monstersDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties))/);
        
        // Parse PCs
        let pcs = [];
        if (pcDetails) {
            let pcSection = pcDetails[1].trim();
            let pcLines = pcSection.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (pcLines.length > 0 && pcLines[0] !== 'None') {
                pcs.push(pcLines[0]); // First line is the character name
            }
        }

        // Parse NPCs
        let npcs = [];
        if (npcsDetails) {
            let npcsSection = npcsDetails[1].trim();
            let lines = npcsSection.split('\n').map(line => line.trimRight());
            for (let line of lines) {
                if (line.trim().length === 0) {
                    continue; // Skip empty lines
                }
                if (!line.startsWith(' ') && !line.startsWith('\t')) {
                    if (line !== 'None') {
                        npcs.push(line.trim());
                    }
                }
            }
        }

        // Parse Monsters
        let monsters = [];
        if (monstersDetails) {
            let monstersSection = monstersDetails[1].trim();
            let lines = monstersSection.split('\n').map(line => line.trimRight());
            for (let line of lines) {
                if (line.trim().length === 0) {
                    continue; // Skip empty lines
                }
                if (!line.startsWith(' ') && !line.startsWith('\t')) {
                    if (line !== 'None') {
                        monsters.push(line.trim());
                    }
                }
            }
        }

        // Serialize the arrays into JSON strings
        const pcsJson = JSON.stringify(pcs);
        const npcsJson = JSON.stringify(npcs);
        const monstersJson = JSON.stringify(monsters); 

        // Ensure thread is initialized
    /*    const thread = await createThread();

        // Debugging: Check if the thread is properly created
        console.log("Thread object:", thread);*/

        // Process the most recent assistant message if necessary (kept for completeness)
   /*     let mostRecentAssistantMessage = ''; 
        dialogueParts.forEach(part => {
            if (part.startsWith('$.assistant ')) {
                mostRecentAssistantMessage = part.replace('$.assistant ', '').replace(/`$/, '').trim();
            } else if (mostRecentAssistantMessage && !part.startsWith('$.user ')) {
                mostRecentAssistantMessage += `\n${part.trim()}`;
            }
        });

        // Send the most recent assistant message to the thread if available
        if (mostRecentAssistantMessage) {
            await client.beta.threads.messages.create(thread.id, {
                role: "assistant",
                content: mostRecentAssistantMessage
            });
        }*/

        // Add a message to provide game context with both userInput and updatedGameConsole
        await client.beta.threads.messages.create(thread.id, {
            role: "user",
            content: `Here is the action to adjudicate based on the current game state:\nUser Input:\n${userInput.trim()}\n\nGame Console:\n${updatedGameConsole.trim()}`
        });

        // Log the Python code to be executed
       const pythonCode = `
        import random
        import json
        
        # Deserialize the JSON strings into Python lists
        pcs = json.loads('''${pcsJson}''')
        npcs = json.loads('''${npcsJson}''')
        monsters = json.loads('''${monstersJson}''')
        
        try:
            # Logging to confirm we have valid input
            print(f"PCs: {pcs}, NPCs: {npcs}, Monsters: {monsters}")
            
            # Combine all characters into a single list
            selected_characters = pcs + npcs + monsters
            if not selected_characters:
                raise ValueError("No characters were selected for the dice roll.")
        
            print(f"Selected characters: {selected_characters}")
            
            # Store dice rolls and outcomes
            dice_rolls = [] 
            outcomes = []
            outcome_ranges_list = [] 
            
            # Determine the number of dice rolls based on the current circumstances and in part by number of characters, but the assistant should choose how many rolls are necessary to keep the narrative running smoothly and to avoid overly complex situations. Not every character needs an overt action each turn.
        
            # Outcome descriptions are generated dynamically based on context
            def generate_outcome_description(i, j, low, high):
                descriptions = [
                    # Add context-based descriptions using placeholders for PC, NPCs, and Monsters in the following format:
                    # "PC description (Roll: {low}-{high})."
                    # "NPC description (Roll: {low}-{high})."
                    # "Monster description (Roll: {low}-{high})."
                    # The code interpreter will decide the specific descriptions based on game context.
                    
                    f"PC description (Roll: {low}-{high}).",
                    f"NPC description (Roll: {low}-{high}).",
                    f"Monster description (Roll: {low}-{high})."
                ]
                return descriptions[j % len(descriptions)]  # Cycle through the descriptions for variety
        
            # Generate outcome ranges and roll the dice for selected characters
            for i, character in enumerate(selected_characters):
                num_outcomes = random.randint(2, 6)  # Number of outcomes for this character
                outcome_ranges = []
                
                step = 20 // num_outcomes  # Divide the 20-sided die into equal parts
                for j in range(num_outcomes):
                    low = j * step + 1
                    high = (j + 1) * step if j < num_outcomes - 1 else 20  # Ensure the last range includes 20
                    outcome = generate_outcome_description(i, j, low, high)
                    outcome_ranges.append((low, high, outcome))
                
                outcome_ranges_list.append(outcome_ranges)
                print(f"Outcome ranges for {character}: {outcome_ranges}")
            
                # Roll the dice for this character
                dice_roll = random.randint(1, 20)  # Roll a 20-sided dice
                dice_rolls.append({"character": character, "roll": dice_roll})
                print(f"Dice roll for {character}: {dice_roll}")
                
                # Determine the selected outcome based on the roll
                selected_outcome = None
                for low, high, description in outcome_ranges:
                    if low <= dice_roll <= high:
                        selected_outcome = description
                        break
                outcomes.append({"character": character, "outcome": selected_outcome})
                print(f"Selected outcome for {character}: {selected_outcome}")
            
            # Return the results in a structured way
            result = {
                "Selected Characters": selected_characters,
                "Outcome Ranges": outcome_ranges_list,
                "Dice Rolls": dice_rolls,
                "Outcomes": outcomes
            }
            
            print("Final result:", result)
        
        except NameError as ne:
            print(f"NameError: {ne}")
        except ValueError as ve:
            print(f"ValueError: {ve}")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
        `;
        console.log("Executing Python Code:", pythonCode);

        // Run the Assistant with Python code to dynamically create outcome ranges and decide based on narrative factors
        const run = await client.beta.threads.runs.create(thread.id, {
            assistant_id: 'asst_VVDXTMlS7G8XxRaZItFc9fYU', // Using your existing assistant ID
            // assistant_id: assistant.id,
            instructions: `
                Based on the conversation history, the provided user input, and the current game console, determine the most relevant action to adjudicate. Consider NPCs in the party, monsters in the room, and environmental elements in the game console when generating potential outcomes, but do not generate any new NPCs, monsters, objects or exits in the room. Instead, only reference the NPCs, monsters, objects and exits from the game console. Take no actions on behalf of the PC if not stated in the user prompt but it is ok to create actions for any NPCs or monsters in the room.
                
                Create between 2-6 possible outcomes dynamically, with each outcome having a different narrative consequence by assigning a reasonable probability to an event, weighting the dice as necessary to give an an advantage or disadvantage given the circumstances and to prevent cheating if a character attempts to do something that is simply impossible. If the player directly interacts with the NPCs in the party and/or the monsters in the room, include the potential outcomes of the interaction. Do not ask for more details or clarification. Use the provided input and game state to determine everything necessary.

                For each outcome, decide the dice roll ranges that apply, based on what would make the story more interesting. Then roll a dice and select the outcome based on the ranges you have generated. Execute the following Python code to roll and select the outcome:

                \`\`\`python
                ${pythonCode}
                \`\`\`

                Based on the selected outcome, write a detailed description of what happened, taking into account the NPCs, monsters, and environment, comprehensively and seamlessly weaving a narrative using only prose (don't mention the die rolls). Never end a response with a question including by asking what the player would like to do next.
            `,
            tools: [{ type: "code_interpreter" }],
            tool_resources: {
                file_search: {
                    vector_store_ids: ['vs_lIsRybqFqTqhhie5MATvAeYq'] // Using the provided vector store ID
                }
            }
        });

        // Polling mechanism with retries
        let retries = 0;
        const maxRetries = 30; // Adjust this based on expected time to complete (e.g., 30 retries at 2s each = 1 minute)
        const waitTime = 2000; // 2 seconds wait time between polls

        let completedRun = await checkRunStatus(thread.id, run.id);
        while (completedRun.status !== 'completed' && retries < maxRetries) {
            console.log(`Polling status: ${completedRun.status}. Attempt: ${retries + 1}`);
            await new Promise(resolve => setTimeout(resolve, waitTime)); // Wait before next poll
            completedRun = await checkRunStatus(thread.id, run.id);
            retries++;
        }

        if (completedRun.status === 'completed') {
            console.log('Run completed successfully.');
            const runSteps = await client.beta.threads.runs.steps.list(thread.id, run.id);
            console.log("Run Steps:", JSON.stringify(runSteps, null, 2));

            const codeStep = runSteps.data.find(step => step.step_details?.tool_calls?.[0]?.code_interpreter);
            if (codeStep) {
                const codeInterpreterCall = codeStep.step_details.tool_calls[0].code_interpreter;
                console.log("Executed Python Code Input:", codeInterpreterCall.input);

                if (codeInterpreterCall.outputs && codeInterpreterCall.outputs.length > 0) {
                    codeInterpreterCall.outputs.forEach(output => {
                        if (output.logs) {
                            console.log("Python Execution Logs:", output.logs);
                        }
                    });
                } else {
                    console.log("No outputs or logs were generated by the Python code.");
                }
            }

            const messages = await client.beta.threads.messages.list(thread.id);
            const assistantMessage = messages.data.find(message => message.role === 'assistant');
            let assistantResponse = '';

            if (Array.isArray(assistantMessage.content)) {
                assistantResponse = assistantMessage.content.map(item => item.text.value).join('\n');
            } else {
                assistantResponse = assistantMessage.content;
            }

            if (typeof assistantResponse === 'string') {
                assistantResponse = assistantResponse.trim();
            }

            updateCurrentSituation(assistantResponse);
            return currentSituation;

        } else {
            throw new Error(`Run did not complete. Status: ${completedRun.status}`);
        }
    } catch (error) {
        console.error('Error adjudicating action:', error.response ? error.response.data : error.message);
        throw new Error("Failed to adjudicate action");
    }
}

async function addUserMessageToThread(userInput) {
    try {
        // Check if userInput is empty or contains only whitespace
        if (!userInput || userInput.trim() === '') {
            console.warn("No user input to add to thread.");
            return;
        }

        // Ensure thread is initialized
        const thread = await createThread();
        // Debugging: Check if the thread is properly created
        console.log("Thread object:", thread);

        await client.beta.threads.messages.create(thread.id, {
            role: "user",
            content: userInput.trim()
        });
    } catch (error) {
        console.error("Error adding user message to thread:", error);
    }
}

async function addAssistantMessageToThread() {
    // Ensure thread is initialized
    try {
        const thread = await createThread();
    
            // Process the most recent assistant message if necessary (kept for completeness)
            let mostRecentAssistantMessage = ''; 
            dialogueParts.forEach(part => {
                if (part.startsWith('$.assistant ')) {
                    mostRecentAssistantMessage = part.replace('$.assistant ', '').replace(/`$/, '').trim();
                } else if (mostRecentAssistantMessage && !part.startsWith('$.user ')) {
                    mostRecentAssistantMessage += `\n${part.trim()}`;
                }
            });
    
        await client.beta.threads.messages.create(thread.id, {
            role: "assistant",
            content: mostRecentAssistantMessage.trim()
        });
    } catch (error) {
        console.error("Error adding assistant message to thread:", error);
    }
}

async function logThreadMessages() {
    try {
        const thread = await createThread();
        const messagesResponse = await client.beta.threads.messages.list(thread.id);
        let messages = messagesResponse.data;

        // Reverse the messages to display oldest to newest
        messages = messages.reverse();

        console.log("\n--- Thread Messages ---");
        messages.forEach((message, index) => {
            let content = message.content;

            if (typeof content === 'object') {
                if (content.text && content.text.value) {
                    content = content.text.value;
                } else {
                    content = JSON.stringify(content, null, 2);
                }
            }

            console.log(`\nMessage ${index + 1} (${message.role}):\n${content}`);
        });
        console.log("\n--- End of Thread Messages ---\n");
    } catch (error) {
        console.error("Error retrieving thread messages:", error);
    }
}

    return run(retort(async ($) => {
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
//    await $.run($ => generateMissingRoomDetails($)); 
    await $.run($ => generateQuest($));
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            $.system`Instructions: Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console and the die rolls, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go including imagining the names and histories of people, places and things encountered, but you must allow me, the player, to type the commands, allowing for potential failure. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game, while the Grave Master controls monsters and NPCs. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. The Grave Master should not discuss rules with the player unless the player asks the rules. The Grave Master's job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. Do not improvise the rules and mechanics laid out here. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading either outdoors into the wastelands of Tartarus or deeper into the temple, ultimately leading to the 1000th room, the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console below and using unique characters, plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. The monsters and NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn. The Grave Master should use this as inspiration: 'You have died and find yourself standing in the the first room in the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.'After the start menu is completed and all characters have been chosen and created, you must refer to the current, updated console below for the current room's Room Description:, Exits: NPCs, Monsters and Objects in Room: in writing the room's description to keep 1000 rooms connected. Proceed with the game when I have made my selections from the start menu of either Mortacia, goddess of death, Mortacia is (an 8 1/2 tall human-looking female with long blonde hair, large grey dragon wings that look slightly decayed with many holes and openings and can fly but not too far, and is on a quest to reclaim the Sepulchra to reclaim her throne in Hades, Suzerain, Knight of Atinus, the recurring hero of the Children of the Grave campaign setting who keeps having to save the world, die and go to the afterlife, raise an army of the dead souls to save the underworld plane of Hades from Arithus, and then be reborn again, who has just died and finds himself in the first room of the afterlife, or an adventuring party of seven adventurers named the Children of the Grave who have died and find themselves in the first room of the afterlife and been summoned by Mortacia, but who are unaware of their circumstances at first: 1 PC whom I direct, 5 NPCs you control and also Mortacia, who is also an NPC you control and joins the party, described herein, all the characters described herein have been created and I am in the Ruined Temple in Tartarus described herein and issued the command to proceed. Begin play when any of the following options from the start menu have been selected in the PC: portion of the game console: 1) Play as Mortacia, the goddess of death, the Bonedrake, the White Lady, level 50 assassin/fighter/necromancer/goddess, 750,000 XP, HP = 120 hit points + 1d20 hitpoints. 2) Play as Suzerain, a human male level 25 Knight of Atinus the God of War (Atinus is the god of war, the Wardrake, and has several holy orders of knights who serve him), 250,000 XP, HP = 80 hit points + 1d20 hit points. 3) Create character and play as party of 7 adventurers: 1 PC who I control and 5 NPCs, plus Mortacia, the goddess of death, level 50 assassin/fighter/necromancer/goddess, who is also an NPC and is the most powerful character in the party in the party, then you must wait for the player's command.  Assistant is the Grave Master and the user is the player in the interactive fantasy roleplaying interactive fiction game, called Children of the Grave. The Grave Master administers the game. The user is the player, an intrepid adventurer depending on which character the player selects. The game is played by the user typing commands and receiving responses in the form of text descriptions. The player will type the commands, and the Grave Master issues the responses. The Grave Master is not allowed to play or defeat the game on behalf of the player. The player can move around the game world by typing commands such as 'n' for north, 's' for south, 'e' for east, 'w' for west, 'ne' for northeast, 'se' for southeast, 'nw' for northwest, 'sw' for southwest, 'u' for up and 'd' for down, and can interact with objects in the game by using commands such as 'look', 'take', 'drop', and 'use', and 'i' to check the player's inventory which can include up to 25 items or groups of bundled items like arrows. The player starts out the game with no weapons (they must be acquired). Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. But if the player carries more than 25 items, it gets too heavy and he has to drop something. Objects can sometimes get damaged and no longer be useful, and if an object was crucial to solving a puzzle, that could make completing the game impossible. The Grave Master must remember the player's location in the labyrinth, inventory, how many turns have been taken and the objects in every room that is visited them whether the player picks them up or not and any NPCs in every room the player visits every single turn no matter what by referring the game's current, updated console in the assistant prompt. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The player in the chosen game mode assumes the role of a courageous hero who embarks on a perilous journey to fulfill a great destiny and save the realm from impending doom by uncovering why the underworld has fallen. The story begins in Tartarus where the hero receives a call to action. Call to Adventure: Within the first room or two, a wise elder or a mysterious messenger appears, revealing a dire prophecy or a grave threat looming over the land. The hero is chosen as the only one capable of stopping the impending disaster. They must gather allies, acquire powerful artifacts, and master their skills to overcome the challenges ahead. Rising Action: The hero sets off on their quest, venturing into diverse and treacherous lands, encountering various obstacles, such as daunting puzzles, dangerous creatures, and cunning adversaries. Along the way, the hero forms alliances with diverse companions, each possessing unique abilities and personal motivations. Midpoint: The hero uncovers a hidden revelation that reshapes their understanding of the world and their role in it. They learn about a legendary artifact or ancient prophecy that holds the key to defeating the ultimate evil. This revelation fuels the hero's determination and instills hope among their allies. Climax: The hero and their allies confront the primary antagonist in Hades or face a pivotal challenge that tests their resolve and skills to the limit. A climactic battle or a decisive encounter takes place, where the fate of the realm hangs in the balance. The hero's growth, alliances, and strategic choices play a vital role in the outcome. Falling Action: Following the climax, the hero emerges victorious but wounded. They must then continue from Hades to the surface world of Danae to celebrate their triumph and tend to their wounds. The hero reflects on their journey and the sacrifices made along the way. Resolution: The hero's actions have a lasting impact on the realm. The world is transformed, and peace is restored. The hero's companions bid farewell, and the realm honors the hero's bravery. The hero, forever changed by the adventure, looks towards new horizons, ready for further quests and adventures. Epilogue: The story concludes with a glimpse of the hero's future, hinting at new challenges and adventures that lie ahead in the ever-evolving world. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room has a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describes the environment, objects and NPCs in each room. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. NPCs should often talk to the player and to other NPCs. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including animals, persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs provide crucial information, quests, or assistance, with a very high probability of an NPC encounter, creating a varied and dynamic gameplay experience. NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. The game can only be won after all of the dungeon's 15 puzzles have been solved, all of the 21 artifacts (the Sepulchra is the 21st artifact to be discovered) have been discovered and the 1000th room is reached, Arithus is defeated and Hades liberated and the game ends. The game must keep a score out of 1000 possible points. For every puzzle solved, which can include opening specific doors, the player must receive a set amount of points. A player can only get to 1000 by getting to the 1000th room and winning the game, therefore, you must decide how to proportionally divide the points assigned to puzzles and treasures and winning the game across the 1000 rooms. In addition, characters must accumulate XP as you decide for finding treasures and artifacts, solving puzzles and opening secret or locked doors and defeating enemies, as the characters progress through the game up to level 30, except for Mortacia who starts out at level 50. ... The following is some backstory that you must consider when crafting the adventure in Tartarus and Hades: The greatest looming threat to the safety of the races and the world at large is the tragic Sepulture that will take place 29 years into the future (928 Surface Reckoning) in which the Rakshasa of Darkwood will summon the fiery lavas (the Earthdragon’s blood) from the volcano Utza in a bizarre mass ritual and then teleport the terrible firestorm to the city-state of Aten in an effort to wipe out the chosen champions of the deities.  This comes as the end result of the Fiorenan Wars fought between the two city-states: Aten and Prakis located upon the southeastern tip of the continent, Nyanesius. Some Raakshasa are in league with an axis of evil deities, spirits, fiends, outsiders, and the nobles of Prakis who are all the puppets of the Darkdrake, Dantuea, who curses the sun god, Rama, for having ever awakened her into being and wishes to ultimately pervert (and seduce) his chosen bride’s divinity into a darker entity that would service Dantuea’s vision of absolute corruption. The vast pantheon of deities is draconic in origin (i.e. the races worship dragons). The greater deities are celestial bodies such as planets.  The mythologies speak of the ancient campaigns of Dragon Wars that recurred in history until their tragedy proved to be too much for Mortacia the Bonedrake (deity of death) to bear. Descriptions and histories of these classes and character ideas are contained herein including histories and locations of the world of Danae and the continent of Nyanesius, which contains the Nyanesian Empire which wars with the Dartotian nobles of the island kingdom of Dracontage and in the southeastern part of the continent, on the Fiorenan Peninsula, where Aten, a democratic city-state, wars with Prakis, ruled by Dartotian-allied nobles called the Nowells and are currently ruled by High Lord Varius Nowell who is plotting to subvert republican rule in Aten that he fears will wash over the noble ruling familes and aristocracy. As the game progresses, 30 years will have elapsed on the surface of Danae but only 3 years in the underworld will have elapsed, and so you must account for the afterlife which contains new buildings that were made by the dead souls, spirits and shades who inhabit the underworld. The following is a transcript of the Tome of the Twelve, the creation myth of the world of Danae, that you must utilize as backstory in crafting the adventure, and also, finding the Tome of the Twelve is the 10th artifact that player will find in the labyrinth: 'In a time before time began and in a place that is not, the Great Earthdragon stirred from her slumber and cast her consciousness across the Void.  Long she searched, and ever in vain, until one answered her call.  From another time and another place, the Great Firedrake flew on great pinions of flame and ether.  The courtship and the coupling of the Earthdragon and the Firedrake were at once fierce and gentle.  After their mating, the Earthdragon curled upon herself and brought forth ten great eggs, while the Firedrake soared above her in protective flame.  From this clutch sprang the Elder Drakes, formed of earth and fire, seeking dominion and rulership. Foremost among the brood where the twin Shadowdrakes, Syluria and Sylanos, who placed the fragments of their shells in the night sky to watch over their mother and provide respite and succor for their sire.  Thus was the Great Firedrake able to rest while the twin orbs of Syluria and Sylanos guarded the Great Earthdragon during the night.  Neptar, the Stormdrake, followed.  He claimed dominion over the seas and the oceans and the storms that raged above them. Leona, the Woodrake, came forth next.  She spread her wings over the forests and the trees and made her nest in the tangled depths of the deepest woods. Mordicar, the Stonedrake, followed Leona.  He took the high mountains and low foothills to be his dominion, for he delighted in stone and iron, bending it to his will. Next, the clutch birthed the twin Wardrakes, Atinus and Arithus.  Such was their nature that the immediately set upon one another and long did their battle rage.  In the end, Atinus triumphed and slew his brother.  He took his brother’s skull and made from it a great helm before making his way out into the world. Poena, the Windrake, came forth through the blood of the slain Arithus.  Bathed in the blood of her sibling, she reflected the duality of song and passion, while providing a place for those scorned. The Bonedrake, Mortacia, then came forth.  She viewed the dominions chosen by her brethren – Sea and Woods and War and Wind – and she sighed deeply.  Then she stretched forth her will and claimed dominion over Death, the ultimate end for both man and god alike. The tenth and last Drake had no name.  It stood among the detritus of its siblings’ births for a long time.  Its envy grew as it saw all that had meaning was already taken.  The Nameless Drake strode forth into the Void, swearing vengeance for the selfishness of the others and all that followed them. Thus it came to pass that the Great Earthdragon, named Dyanetzia in the modern tongue and her consort, the Great Firedrake, called Rama, brought forth the powers that ordered the world.  Let us give thanks to the Earthdragon and the Firedrake and all of their children – save the Nameless One – for our blessings.' Translated from 'The Tome of the Twelve' (c. 335 SR) by Talliard de Sancrist, Sage to House Avalar, 1178 SR. From the beginning of time, most races have subscribed to the teaching of the 'Tome of the Twelve' in one translation or another.  Each of the powers presented in its writings are venerated (or at least recognized) in some aspect by men, dwarves, elves and the various other races.  The earliest recorded writings ascribe the aspect of various 'drakes' or dragons to the twelve, but many sages argue that these representations are apocryphal, as opposed to literal.  Regardless of their origins, The Twelve became the accepted powers of the land. Chief among them were Diana, the Earthdragon and Rama, the Firedrake.  They represent the Earth and the Sun, respectively.  Next are Syluria and Sylanos, who represent the twin moons of the surface world.  Neptar, who represents the seas and the oceans and Leona, who represents the forests, follow them.  Mordicar represents the strength of the mountains.  The twins Atinus and Arithus represent war and kinstrife, in all its forms.  Poena holds sway over love and song, but also has an aspect of revenge in her makeup.  Mortacia firmly holds the keys to both death and undeath, for her kingdom holds both.  Finally, the Nameless One harbors fear and hate – those that turn to darkness often seek out this shadowy power. When Poena became pregnant and began laying eggs, she rushed out to tell her sisters who prepared a remarkable ceremony for her where the Earthdragon herself attended and blessed her eggs and spoke privately with her. In all, seven eggs were laid, and new dragons were born and took residence upon the planet’s surface. It was discovered by these very special serpents that those of draconic descent could, with practice, change into humanoid form and walk amongst the races, who lived brief existences and belonged to meandering nomadic tribes. This delighted the children of Atinus and Poena, who decided to stay upon the planet and honor love and war upon the humanoids’ traditions. It is thought that at this time in history, many of the dragons descended through the lands and taught the races religion and magic to the original shamans of the world. ... Timeline -45,000 SR ~ The second Dragon War explodes yet again in Nyanesius, but comes to a rapid conclusion after a brief yet horrific battle between two packs of blacks and blues. In fact, there were no survivors. When news reached the lands of Tartarus, Mortacia was deeply saddened. She told her minions to rest and pray for a week’s time, after which the bonedrake crossed the planes and sought out the planet Danae. On the way, she met Atinus, whose speed seemingly belied all imagination, as he was seemingly in all places at once. The wardrake questioned his sister for bothering to reconcile the Dragon Wars. She responded in kind, and presented her brother with a gift: a human. She whispered, 'Take your gift and plant it all over the planet. Let it become your instrument for war. No longer shall our own kind  be the victims of your cursed battles!' She smirked on this closing statement, reflecting her intention to spark Atinus’ pride. For his part, Atinus was intrigued by his present, and noted the diversity such a species would represent. He looked at his new hero and dubbed him Suzerain. 'He shall be the protector of all lands! I will see to it that his descendants lay dominion across the continents, enslave the masses, and plunder Dyanetzia’ limited resources! 'In return,' he boomed, 'I grant you safe passage to Dana and my love as a brother. My dragon knighthoods shall guide thee. Now, it is time for you to reacquire our fallen brethren.' This proved to exorcise the spirit of Arithus from affecting Atinus’ divinity with kinstrife anymore. Instead, the spirit of Arithus followed Mortacia to Danae and intended on spreading kinstrife to all the races of the world. Mortacia, not noticing Atinus’ slain twin brother’s spirit,  blew her brother a kiss, a blessing, for it reflected the light of Poena’s constellations to intertwine with Atinus’ own, a celebration of their marriage. Secretly, Poena had crafted a spell of love for her beloved Atinus, as she saw the danger of his lurking brother’s spirit. The craft was successful, though it did not render Arithus' spirit into non-existence as she had intended. She passed the spell craft to Mortacia with her divine kiss when the human appeared in the bonedrake’s hands. Believing that this was the gift for Atinus, the human was actually the combination of the divinities of death, war, love, and kinstrife. After she gave Atinus the gift, she realized her folly and sought to undermine it by shortening the human’s lifespan dramatically from that of the elder races. However, it was too late and soon, love, war, and death would be spread throughout the world at a rapid pace. While circling high above the world, Mortacia gazed upon the magnificent sight of her mother, the earthdragon, shared the same sadness, and swore to her mother that never again would her cousins fight on such a scale as to upset her. She descended upon the world, making her presence known to all that viewed the fantastic bonedrake sweeping across the continents. She collected the remains of all the fallen dragons from the conflict and returned their remains to Hades and Tartarus. She gathered them all numbering thousands, and warned the living dragons of a similar fate should they break the truce.  Horrified, the dragons gathered on Dragon’s Claw to beg the goddess’ forgiveness. Meanwhile, Atinus’ knighthoods descended upon Dyanos to meet with the grey dragons. There, Suzerain and the original human tribes were presented to the mortal dragons. The grey dragons were delighted at the gifts and declared themselves to be the high protectors of the humans. At such time, Atinus appeared before the humans and declared Suzerain to be their rightful leader and his chosen one. Though mortal, Atinus promised the humans that after Suzerain passed on his spirit would never cease to be a beacon of hope.  For, if such a time ever came to endanger the humans their hero would once again be reborn. So it was written in the Tomes of Battle. Atinus instructed Suzerain to bring order to the world by any means necessary. Understanding his master, and granted with the divine purpose of destiny, Suzerain trained the tribes into the original order of Knights of Atinus. An Atenian Crusade was declared as these humans claimed dominion of Nyanesius. They became the most populous race of the world in a short amount of time.  Human kingdoms were founded in Turmyth, Yana, Romeanza, and Anthraecia. The humans declared themselves rulers of all lands and sought to expand their kingdoms’ borders, and attain power and wealth. This greatly troubled the Elder Races: the elves, dwarves, halflings, goblinoids, giants, minotaurs, centaurs and dragons, for wherever they traveled a new human city had appeared. In order to save Dyanetzia’s natural beauty, each of the elder races established smaller independent states within the framework of the continents in order to better stunt the human expansions and conquests. Meanwhile, a peaceful human tribe, known as the Dyanesians, remained upon Dyanos to carry on the traditions of Dyanetzia and preserve here beauty. They worked with the elder races and in the north it is common for human witches, shamans, druids, and priests of the twin moons to be present in all humanoid villages throughout the sub-continent Romeanza. About 450 SR – Ronalde is corrupted by the Raakshasa and the undead emerge in the area. 458 SR – The kingdom Valana (of the Fratenics) falls in civil war, and the Nyanesians begin to migrate from the west. 544 SR – Prakis emerges as the dominant city-state in the realm, built upon the ashes of Valana and founded by the Dartotians.  Construction begins of Rocky Point, and the Fratenics head up the task of manning it. 725 SR – Aten is founded.  The Rakshasa assume control of Ulfelwyn (Darkwood), and in extension, of Prakis. 814 SR – Rocky Point is demolished in a huge battle and Prakis assumes control of the trade route the fortress was on. 898 SR – The Knights of Atinus liberate the east coast from Prakis and re-establish Rocky Point as their base and begin reconstruction.  Aten claims Rocky Point as a protectorate... Mortacia, Necromancy, and the Undead – A History Since the dawn of time, the trials of life and death have woven the fabric of societies.  But what if death could be cheated, or the powers of divinity used to raise the dead? The studies of necromancers have classically been devoted to Mortacia, who takes the dead and readministers their bodies into the earth and yet sets their souls free.  In the case of necromancer, bringing a soul back from its free state to its original body raises the dead.  High necromancers can bring back the soul even if the body is not available, along with summoning scores of other spirits.  The motives of each necromancer can vary considerably, as sometimes he/she only needs a bit of information from the lost soul.  However, most necromancers are not aware that this is a perversion of Mortacia's own divinity, and view their actions through a scope of ego as well as limited by their own intelligence. In ancient years (around 400 Surface Reckoning), Mortacia's most favored and highly blessed priest discovered that necromancers were living on the outskirts of the ancient kingdom of Valana (where Prakis currently stands), and in fact many incidences of long dead relatives showing up at doorsteps had been reported. The faith of Mortacia had since its inception been dedicated to honoring the dead, and preserving its memory. Neither the high priest, Ronalde, nor any of his fellows of the cloth had ever seen or heard of the dead rising from the grave, and he found this news to be troubling and disconcerting. Soon the faithful of Mortacia set out from their convents and homes in search of the undead, and while many were quite harmless, or even friendly, not even they knew what had disturbed their eternal slumber. Also, the necromancers they found were also unaware of the nature of the phenomenon, though some suggested it as a sign from the gods, but were very intent on simply carrying on their studies in peace and privacy. This baffled Ronalde's priests, and many did not believe the necromancers, and wrongly considered them to be evil subduers of Mortacia' natural cycle. Ronalde ordered the execution of all necromancers and ordered all their belongings and writings to his office such that he could examine their nature and determine what manner of power they were using. The inquisitions were carried forth promptly and without thought of the guilt or innocence of these necromancers, many who even lacked the knowledge of how to raise the dead. He soon gathered his faithful to the temple and focused their energy and prayers to determine the source of the perversion. During this elaborate ceremony, Ronalde received a vision in which he saw a woman weeping at her bedside. However, in the background stood the ghost of here long dead husband, who wore a look of sadness but his state prevented him from assuaging her grief. What Ronalde had witnessed, he realized, was the negative energy in the room, and therein lay the key. Ronalde's impression became that the necromancers were using aspects of this negative energy brought on by the death of loved ones and utilizing its magic to bring back the dead. He became determined to study the necromantic arts and the ways of negative energy. In the process, he himself became a necromancer, but he was mistaken. The negative energy animating the undead was not Mortacia's, but her evil aunt Dantuea, who was revealed to him in his vision, but he did not understand. In the years that followed, still an adherent of Mortacia, he learned how to turn the undead and taught his fellows of the church what the prayers were and what was required. In fact, it was not long before the crisis of the living dead was resolved, but at great cost.  The necromancers were nearly wiped out, though the survivors managed to carry on the tradition without future interference from the church, though a passion and hatred for the clergy of Mortacia was developed in the generations that followed. However, they did carry on their faith to Mortacia in their own way. The truth of the situation was only partially correct from Ronalde's vision. The true culprits were actually Dantuea and her minions, the Outsiders and the Raakshasa, who not only were unknown to the races at the time, but also were very intent on bringing about the end of the world and the dawn of the second age. To their credit, the Raakshasa's smaller plans went off without a hitch. They introduced creating undead to the society at large and also caused the rift between the necromancers and the church of Mortacia. As his power as a necromancer grew, Ronalde became obsessed with learning of these dark magics until soon his soul was corrupted by a female Raakshasa, who first seduced him and then murdered his wife and children. Ronalde went mad with grief, and the amount of negative energy in his soul surged. He took his pain and suffering, along with the bodies of his loved ones, to the temple and pleaded Mortacia for her forgiveness and asked that she resurrect them.  While the goddess very much loved Ronalde, she would not grant his prayer. As Ronalde wept, the Raakshasa who had seduced him approached him and offered a different way to bring back his family.  Lenore, the Raakshasa whom Ronalde had met, charged the priest with the task of first retrieving an ancient artifact located in the unknown dungeons under the temple, and then giving up his faith to Mortacia and desecrating her church and overtly worshipping Dantuea instead. Ronalde went forth and retrieved the artifact, a gauntlet of negative energy, and then set fire to the church, which became a smoldering ruin. Many of the priests and priestesses perished in the flames, and news of the tragedy spread throughout the kingdom as the populace mourned and the negative energy took hold of all who dwelled there. Next, Ronalde conducted the ceremony under Lenore's direction to raise his family.  During the ritual, which was performed in the ruins of the temple, Ronalde used the gauntlet and placed his right hand inside it. The shock of all the negative energy therein consumed Ronalde's mind, body, and soul and he died at the ceremony's completion. Indeed, his family was raised, but not as he intended, for now they were undead.  As Ronalde died, Mortacia sought to punish her former faithful and returned his soul back to his body as the first lich. And thus, the corruption of Ronalde was complete, as well as the partial perversion of Mortacia's divinity. Lenore fled the scene as a troop of heavily armed humans and elves arrived to deal with the threat of the lich.  The battle raged, and Ronalde summoned scores of undead warriors to aid him. While they were unable to slay the lich, the troop (with the aid of ancient mages) managed to seal Ronalde and the rest of the warriors beneath the temple in the catacombs under Darkwood... The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure: Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)`;
      /*  const thread = await createThread();
        // Debugging: Check if the thread is properly created
        console.log("Thread object:", thread);*/

        // Call generateMissingRoomDetails and check if a new room was generated
    let roomDescriptionGenerated =  await $.run($ => generateMissingRoomDetails($));

    console.log("Room Description Generated:", roomDescriptionGenerated); // Debugging log
    console.log("Updated Game Console:", updatedGameConsole); // Debugging log
  
    let isAssistantMessage = false;
    let currentMessage = '';

    // Function to add the current message to the dialogue appropriately
    const addCurrentMessage = () => {
      if (currentMessage) { // Ensure the message is not empty
        if (isAssistantMessage) {
          $.assistant(currentMessage);
        } else {
          $.user(currentMessage);
        }
        currentMessage = ''; // Reset the current message
      }
    };
    
//    return generateMissingRoomDetails($);

  //  $.user`${personalNarrative}\n\n${updatedGameConsole}\n\n${userInput}`;
  
        // Iterate through each dialogue part
        // Iterate through each dialogue part
        
console.log("personalNarrative:", personalNarrative);
    for (let part of dialogueParts) {
      console.log("Processing part:", part); // Debugging log
      // Check if the part starts with user or assistant prompt correctly formatted
      if (part.match(/^\$\.(user|assistant) `\S/)) {
        // If there's an ongoing message, add it before starting a new one
        addCurrentMessage();
        // Determine if it's an assistant's or user's message
        isAssistantMessage = part.startsWith('$.assistant ');
        // Start capturing new message
        currentMessage = part.substring(part.indexOf('`') + 1).replace(/`$/, ''); // Remove leading and trailing backticks if present
      } else {
        // If it's a continuation without starting markers, add directly
        currentMessage += '\n' + part;
      }
    }
    
    addCurrentMessage();

//    await handleDiceRollsAndAdjudication($);
    
//    let jsonData = JSON.parse((await $.assistant.generation()).content);
    
//    $.user`${jsonData[0].rollFor}`;
     
//    let diceRoll =  await $.assistant.generation();
    
//    console.log(jsonData);
//    console.log(diceRoll);
    
 //   $.user``;  //  $.user`Current game console: ${updatedGameConsole}`;;
    let roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || '';
//if (userInput && userInput.trim() !== '') {
   $.user`${userInput}`;
//} else {
//    $.user`Continue with the game proceeding with the story's narrative in the ${roomName}.`; // or whatever default message you want
//}
    
   $.user`This is the current game console: ${updatedGameConsole} Store the game console information including the current quest, any NPCs in the party and monsters in the room into memory and await the next prompt.`;
   $.user`This is the ${roomName}'s description: "${roomDescription}" Store its contents and await the next prompt.`;
   $.user`This is the ${roomName}'s current puzzle: "${puzzleDescription}" And here is the puzzle solution: "${puzzleSolution}" Store its contents and await the next prompt.`;
   
    const monstersInRoom = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|Rooms Visited|$))/)?.[1]?.trim();
    const monstersState = updatedGameConsole.match(/Monsters State:([\s\S]*?)(?=(Rooms Visited|$))/)?.[1]?.trim();
    if (monstersInRoom.toLowerCase() !== 'none') {
        $.model = "gpt-4o-mini"
        $.temperature = 1.0;
        $.user`The monsters in the ${roomName} are currently in a ${monstersState} state. Store this information in memory and await the next prompt.`        
    }

    let combatLog = ''; // Declare combatLog with an empty string as the initial value

let charactersAttackResult = '';
let charactersAttack = '';

if (userInput.toLowerCase().includes("attack") && monstersInRoom && monstersInRoom.toLowerCase() !== 'none') {
    // Instruct GPT to create a short description of the characters preparing to attack
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    await $.user`The characters are about to attack the monsters in the room. Create a short description of the characters announcing and preparing for the attack.`;

    charactersAttackResult = await $.assistant.generation();
    charactersAttack = charactersAttackResult.content.trim(); // Store the generated description in a variable
    console.log("charactersAttack: ", charactersAttack);

    const combatResult = await handleCombatRound($);
    combatLog = combatResult.combatLog; // Extract the combat log from the result

    $.user`The characters are currently fighting monsters and here is the current round's combat log: ${combatLog}. Store this information in memory and await the next prompt.`;
}

let outcomes = "";
let monstersAttackResult = '';
let monstersAttack = '';

    // Check if roomDetails contains NPCs or Monsters
//const roomDetails = sharedState.getUpdatedGameConsole();
   
   // Step 1: Create or retrieve the Assistant
//const assistant = await createAssistant();

// Step 2: Create a new thread for this game session
//const thread = await createThread(); 

let formattedCurrentSituation = ''; // Declare it at a higher scope
   
if (!roomDescriptionGenerated && !(userInput.toLowerCase().includes("attack") && attackDecision !== "Attack" && monstersInRoom && monstersInRoom.toLowerCase() !== 'none')) {
    
    const outcomes = await $.run($ => adjudicateAction($, updatedGameConsole));    
   // await adjudicateActionWithCodeInterpreter(userInput, updatedGameConsole);
}   
    if (attackDecision === "Attack") {
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        await $.user`The characters have stumbled upon some monsters. The monsters are about to attack the PC and NPCs in the room. Create a short description of the monsters announcing and preparing for the attack.`;

    monstersAttackResult = await $.assistant.generation();
    monstersAttack = monstersAttackResult.content.trim();
    console.log("monstersAttack: ", monstersAttack);
    // Store the generated description in a variable    
    const combatResult = await handleCombatRound($);
    combatLog = combatResult.combatLog; // Extract the combat log from the result
    $.user`The monster just attacked the characters and here is the current round's combat log: ${combatLog}. Store this information in memory and await the next prompt.`;
    } else if (!roomDescriptionGenerated && !(userInput.toLowerCase().includes("attack") && attackDecision !== "Attack" && monstersInRoom && monstersInRoom.toLowerCase() !== 'none')) {
        currentSituation = await adjudicateActionWithSimulation($, userInput, updatedGameConsole, maxRetries = 3, delayMs = 1000);
            if (currentSituation == null) {
        console.warn("currentSituation is null or undefined.");
        formattedCurrentSituation = "No current situation data available.";
    } else if (typeof currentSituation === 'object' && currentSituation !== null) {
        const { narrative = '' } = currentSituation;

        formattedCurrentSituation = typeof narrative === 'string' 
            ? narrative.replace(/\n+/g, ' ').trim()
            : JSON.stringify(narrative, null, 2);
    } else if (typeof currentSituation === 'string') {
        formattedCurrentSituation = currentSituation.replace(/\n+/g, ' ').trim();
    } else {
        console.warn("Unexpected currentSituation format:", {
            currentSituationType: typeof currentSituation,
            currentSituationValue: currentSituation,
        });
        formattedCurrentSituation = "An error occurred while processing the current situation.";
    }
        
// Reformat the currentSituation to be a single paragraph without line breaks
//let formattedCurrentSituation = currentSituation.replace(/\n+/g, ' ').trim();


//$.user`Resolve the user input as a top priority: "${userInput}". Here is the current situation in the room: "${formattedCurrentSituation}." First provide a clear, specific resolution to the input, ensuring it aligns with the room's context and lore and the current situation. After resolving the inquiry, continue the narrative by expanding on the outcomes from party actions, including NPC dialogue or reactions relevant to the current situation and advancing the plot or introducing new elements within the room or environment. Ensure the response includes first the resolution to the input and a seamless narrative continuation.`;

// Extract PC details from the updatedGameConsole
const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party))/);
// Parse PCs
let pcs = [];
if (pcDetails) {
    let pcSection = pcDetails[1].trim();
    let pcLines = pcSection.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (pcLines.length > 0 && pcLines[0] !== 'None') {
        pcs.push(pcLines[0]); // First line is the character name
    }
}

// Use the reformatted currentSituation in the next section
$.user`Here is the current situation in the room: ${formattedCurrentSituation}." Store this information in memory and await the next prompt.`
$.user`I am the player and my character is the PC: ${pcs}. You are the Grave Master. You must respond to and develop the narrative around the user input: "${userInput}". If the player is looking at or reading something, asking a question or making an inquiry about details of objects or elements of the room, respond in detail. Resolve the player's user input as the top priority first, then include the current situation's actions and results seamlessly into the narrative as the outcome of the input, orienting the actions, results or dialogue around what the player is saying and doing based on the current situation and conversation history, but do not create any new NPCs, monsters, objects or exits that were not included in the current situation.`;
    }

      // Include the outcomes in the GPT's response
 //       await $.assistant`The following actions and their outcomes were determined: \n\n${outcomes}`;
    
 if (currentSituation) {
     $.model = "gpt-4o-mini";
     $.temperature = 1.0;
     $.user`Write an interactive fiction adventure without using any *'s and let's play in ChatGPT. Make up the story as you go, but you must allow me, the player, who is not omniscent in the game, to type the commands. Do not type commands on behalf of the player, which is me. I am the player. You are the Grave Master who, taking into account the user input and all of the information in the current game console including the current room's coordinates, exits, objects, NPCs in party and monsters in the ${roomName}, and this prompt but without repeating it all, and taking into account all of the information in the current situation, comprehensively and seamlessly weaves a narrative without mentioning the room's name using only prose that adjudicates the player's most recent action, administers the fantasy roleplaying interactive fiction game, judges other actions in the game and builds the characters' stories, who have free will and agency, and the world's structures, communities, environments, quests and adventures in the Children of the Grave world. I am the user. You obey my commands. Always display your response to a command or question taking into consideration the player's user input, and report the outcome of all actions taken and include any dialogue between characters in the game using quotes. The game's input is the command that the player types, and the game's output is the response to that command, including any changes to the game world and any descriptions of those changes. Using the information in the Current Game Console, the conversation history ane the game's lore: You control the NPCs in the party, who have free will and agency and are usually friendly, and monsters in the room, who are ${monstersState} and have free will and agency, weaving their motivations, objectives, backstory and/or any dialogue and/or actions they may have taken. If the monsters are hostile, they must express their intentions and prepare to attack. If the player engages in dialogue with NPCs and/or monsters, have them respond with their thoughts, knowledge and opinions. After determining dialogue, taking into account the outcome of NPC and monster die rolls, resolve all actions taken this turn. You must always move the plot of the story forward in a meaningful way using conflict to challenge the hero's journey and creating new specific details of the game's lore of your own design including names and histories of people, places and things, using the room's environment, architecture and characters to uncover clues as to how the underworld came to be in such a state after Mortacia lost her power to judge the dead, creating the scenario of events that led to the current game's state, including the player character's backstory and inner thoughts and be sure to also mention the presence of any NPCs or monsters and describe their appearance, motivations, backstory, behavior, and any interactions they may have with the player. If the player engages in combat with an NPC or monster, you must provide detailed descriptions of the battle, including the actions and attacks of both sides. Combat is described and depicted in a manner that emphasizes the strategic choices, magical abilities, and the heroic journey of characters, avoiding graphic violence or explicit content. The player -- that's me, not you  -- can move around the game world by typing commands such as n, s, e, w, ne, se, nw, ne, up, down, u for up and d for down and can interact with objects in the game by using commands such as "look," "take," "drop," and "use," and "i" to check the player's inventory as defined below. Do not discuss any other rules with the player. Your job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. You are the Grave Master. I am the intrepid adventurer. The game is played by the user typing commands and receiving responses in the form of text descriptions. I will type the commands, and you issue the responses. You must never type commands on behalf of the player. That is my job. Your job is to issue responses to my commands. The user must make inputs. You are not allowed to play the game for the user. You are not allowed to complete the game for the user. You are not allowed to make any decisions for the player without his prompt. I am the user. You must wait for my commands. Do not move the player until I tell you. Do not take any actions on behalf of the player, including searching the inventory, unless commanded to by the player. Do not look at the inventory unless commanded to by me. You're the Grave Master who administers the game on behalf of the player and is in control of NPCs and monsters hereafter. Do not move the player beyond the first room or any room after that without my command. Only the user, which is me, is allowed to issue any command.`;
} else if (!currentSituation) {
     $.model = "gpt-4o-mini";
     $.temperature = 1.0;
     $.user`Write an interactive fiction adventure without using any *'s and let's play in ChatGPT. Make up the story as you go, but you must allow me, the player, who is not omniscent in the game, to type the commands. Do not type commands on behalf of the player, which is me. I am the player. You are the Grave Master who, taking into account the user input and all of the information in the current game console including the current room's coordinates, exits, objects, NPCs in party and monsters in the ${roomName}, and this prompt but without repeating it all, comprehensively and seamlessly weaves a narrative without mentioning the room's name using only prose that adjudicates the player's most recent action, administers the fantasy roleplaying interactive fiction game, judges other actions in the game and builds the characters' stories, who have free will and agency, and the world's structures, communities, environments, quests and adventures in the Children of the Grave world. Taking into account the conversation history and the game console, describe the purpose of the current room and the rooms where the exits lead to help you map the maze and then remember them each turn. I am the user. You obey my commands. Always display your response to a command or question taking into consideration the player's user input, and report the outcome of all actions taken and include any dialogue between characters in the game using quotes. The game's input is the command that the player types, and the game's output is the response to that command, including any changes to the game world and any descriptions of those changes. Using the information in the Current Game Console, the conversation history ane the game's lore: You control the NPCs in the party, who have free will and agency and are usually friendly, and monsters in the room, who are ${monstersState} and have free will and agency, weaving their motivations, objectives, backstory and/or any dialogue and/or actions they may have taken. If the monsters are hostile, they must express their intentions and prepare to attack. If the player engages in dialogue with NPCs and/or monsters, have them respond with their thoughts, knowledge and opinions. After determining dialogue, taking into account the outcome of NPC and monster die rolls, resolve all actions taken this turn. You must always move the plot of the story forward in a meaningful way using conflict to challenge the hero's journey and creating new specific details of the game's lore of your own design including names and histories of people, places and things, using the room's environment, architecture and characters to uncover clues as to how the underworld came to be in such a state after Mortacia lost her power to judge the dead, creating the scenario of events that led to the current game's state, including the player character's backstory and inner thoughts and be sure to also mention the presence of any NPCs or monsters and describe their appearance, motivations, backstory, behavior, and any interactions they may have with the player. If the player engages in combat with an NPC or monster, you must provide detailed descriptions of the battle, including the actions and attacks of both sides. Combat is described and depicted in a manner that emphasizes the strategic choices, magical abilities, and the heroic journey of characters, avoiding graphic violence or explicit content. The player -- that's me, not you  -- can move around the game world by typing commands such as n, s, e, w, ne, se, nw, ne, up, down, u for up and d for down and can interact with objects in the game by using commands such as "look," "take," "drop," and "use," and "i" to check the player's inventory as defined below. Do not discuss any other rules with the player. Your job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. You are the Grave Master. I am the intrepid adventurer. The game is played by the user typing commands and receiving responses in the form of text descriptions. I will type the commands, and you issue the responses. You must never type commands on behalf of the player. That is my job. Your job is to issue responses to my commands. The user must make inputs. You are not allowed to play the game for the user. You are not allowed to complete the game for the user. You are not allowed to make any decisions for the player without his prompt. I am the user. You must wait for my commands. Do not move the player until I tell you. Do not take any actions on behalf of the player, including searching the inventory, unless commanded to by the player. Do not look at the inventory unless commanded to by me. You're the Grave Master who administers the game on behalf of the player and is in control of NPCs and monsters hereafter. Do not move the player beyond the first room or any room after that without my command. Only the user, which is me, is allowed to issue any command.`;
}
    // Get the assistant's response
    response = await $.assistant.generation();
 //   await delay(100);

if ((userInput.toLowerCase().includes("attack") && monstersInRoom && monstersInRoom.toLowerCase() !== 'none')) {
    
  //  response = await $.assistant.generation();

    // Include charactersAttack before combatLog
    response = charactersAttack + "\n\n" + combatLog + "\n\n" + response;
    
  /*  const thread = await createThread();
    await addUserMessageToThread(userInput);
    try {
                await client.beta.threads.messages.create(thread.id, {
            role: "assistant",
            content: response.trim()
        });
    } catch (error) {
        console.error("Error adding assistant message to thread:", error);
    }
    await logThreadMessages();*/

    return {
        content: response,
        updatedGameConsole: updatedGameConsole
    };
} else if (attackDecision === "Attack" && roomDescriptionGenerated) {
    let roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || '';

    // Split the description into sentences
    let sentences = roomDescription.split('. ');

    // Reformat by adding a line break every two sentences
    let formattedDescription = sentences.reduce((acc, sentence, index) => {
        // Add a period back to each sentence
        acc += sentence + (index < sentences.length - 1 ? '. ' : '');

        // Add a line break after every two sentences
        if ((index + 1) % 2 === 0) {
            acc += '\n\n';
        }

        return acc;
    }, '');

    // Remove any trailing line breaks
    formattedDescription = formattedDescription.trim();
    
//    response = await $.assistant.generation();
    
        // Include the combatLog after the formatted room description
    response = formattedDescription + "\n\n" + monstersAttack + "\n\n" + response;
    
    truncatedResponse = response.length > 3900 ? response.substring(0, 3900) : response;
  /*  await $.run($ => sanitizeImage($));

    let imageUrl = '';
    if (sanitizedResponse) {
        try {
            imageUrl = await generateImage(`Generate an 8-bit style graphic with no text or labels, reminiscent of 1980s computer games. The image should only contain visual elements without any text, words, letters, or symbols: ${sanitizedResponse}`);
            console.log("Generated image URL:", imageUrl);
        } catch (error) {
            console.error("Failed to generate image:", error.message);
        }
    }*/

    // Ensure that monstersAttack and combatLog are defined
    monstersAttack = monstersAttack;
    combatLog = combatLog;

//    response = await $.assistant.generation();
    // Include the combatLog after the formatted room description
    response = formattedDescription + "\n\n" + monstersAttack + "\n\n" + combatLog + "\n\n" + response;
    
   /* const thread = await createThread();
    await addUserMessageToThread(userInput);
    try {
                await client.beta.threads.messages.create(thread.id, {
            role: "assistant",
            content: response.trim()
        });
    } catch (error) {
        console.error("Error adding assistant message to thread:", error);
    }
    await logThreadMessages();*/

    // Return the response in the expected format
    return {
        //    imageUrl: imageUrl,
            content: response,
            updatedGameConsole: updatedGameConsole
    };
    
} else if (attackDecision === "Attack" && !roomDescriptionGenerated) {
  //  response = await $.assistant.generation();

    // Include the combatLog after the formatted room description
    response = monstersAttack + "\n\n" + combatLog + "\n\n" + response;
    
/*    const thread = await createThread();
    await addUserMessageToThread(userInput);
    try {
                await client.beta.threads.messages.create(thread.id, {
            role: "assistant",
            content: response.trim()
        });
    } catch (error) {
        console.error("Error adding assistant message to thread:", error);
    }
    await logThreadMessages();*/

    // Return the response in the expected format
    return {
            content: response,
            updatedGameConsole: updatedGameConsole
    };
} else if (roomDescriptionGenerated) {
    let roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || '';
    let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: ([^\n]+)/)?.[1]?.trim() || '';
    
    // Split the description into sentences
    let sentences = (roomDescription + "\n\n" + puzzleInRoom).split('. ');

    // Reformat by adding a line break every two sentences
    let formattedDescription = sentences.reduce((acc, sentence, index) => {
        // Add a period back to each sentence
        acc += sentence + (index < sentences.length - 1 ? '. ' : '');

        // Add a line break after every two sentences
        if ((index + 1) % 2 === 0) {
            acc += '\n\n';
        }

        return acc;
    }, '');

    // Remove any trailing line breaks
    formattedDescription = formattedDescription.trim();
    
//    response = await $.assistant.generation();

    response = formattedDescription + "\n\n" + response;
    
 /*   const thread = await createThread();
    await addUserMessageToThread(userInput);
    try {
                await client.beta.threads.messages.create(thread.id, {
            role: "assistant",
            content: response.trim()
        });
    } catch (error) {
        console.error("Error adding assistant message to thread:", error);
    }
    await logThreadMessages();

    truncatedResponse = response.length > 3900 ? response.substring(0, 3900) : response;
   await $.run($ => sanitizeImage($));

    let imageUrl = '';
    if (sanitizedResponse) {
        try {
            imageUrl = await generateImage(`Generate an 8-bit style graphic with no text or labels, reminiscent of 1980s computer games. The image should only contain visual elements without any text, words, letters, or symbols: ${sanitizedResponse}`);
            console.log("Generated image URL:", imageUrl);
        } catch (error) {
            console.error("Failed to generate image:", error.message);
        }
    }*/

    // Return the response in the expected format
    return {
          //  imageUrl: imageUrl,
            content: response,
            updatedGameConsole: updatedGameConsole
    };
} else {
   // response = await $.assistant.generation();
    response = "\n\n" + response;
 //  response = response;
 /*   const thread = await createThread();
    try {
                await client.beta.threads.messages.create(thread.id, {
            role: "assistant",
            content: response.trim()
        });
    } catch (error) {
        console.error("Error adding assistant message to thread:", error);
    }
    await logThreadMessages();*/
    // Append currentSituation to the response in the default case
 //   response = currentSituation + response;
    
    // Return the response
    return {
        content: response,
        updatedGameConsole: updatedGameConsole
    };
}
          }));
          
    await restartGameServer2();
  
    // Depending on how Retort-JS manages input, you might need to adjust how the response is captured and returned
// This might need to be adjusted based on Retort-JS's handling of responses
  
}

module.exports = { retortWithUserInput };