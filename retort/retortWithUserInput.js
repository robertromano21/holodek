const { exec } = require('child_process');

const { json } = require('stream/consumers');

const retort = require('retort-js').retort;

const run = require('retort-js').run;

const axios = require('axios');

const { OpenAI } = require('openai');

const fs = require('fs');

const path = require('path');


const { spawnSync } = require('child_process');

const ROOT       = path.join(__dirname, '..');
const RETORT_DIR = path.join(ROOT, 'retort');
const SID_DIR    = path.join(ROOT, 'sid');
const RENDER_JS  = path.join(ROOT, 'assets', 'renderSid_poke.js');

//const client = new OpenAI();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 480000 // 2 minutes in milliseconds
});

//const sse = global.sse;

//const { sse } = require('../server');

// retortWithUserInput.js
const sharedState = require('../sharedState');

let assistant; // Global variable to store the assistant
let thread; // Global variable to store the thread
//let combatMode = true;

function normalizeCoords(c) {
  if (Array.isArray(c)) return { x: c[0] | 0, y: c[1] | 0, z: c[2] | 0 };
  return (c && typeof c === 'object')
    ? { x: parseInt(c.x)||0, y: parseInt(c.y)||0, z: parseInt(c.z)||0 }
    : { x: 0, y: 0, z: 0 };
}
function coordsKey(c) {
  const { x, y, z } = normalizeCoords(c);
  return `${x},${y},${z}`;
}

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

const { renderRoomMusic } = require('./renderAudio');

function writeLatestJsonAndRender(musicJson, lengthSec = 60) {
  const jsonPath = path.join(RETORT_DIR, 'current_room.json');
  fs.writeFileSync(jsonPath, JSON.stringify(musicJson, null, 2), 'utf8');

  const asmOut = path.join(SID_DIR, 'current_room.asm');
  const sidOut = path.join(SID_DIR, 'current_room.sid');

  const a = spawnSync('node', [RENDER_JS, jsonPath, asmOut], { stdio: 'inherit' });
  if (a.status !== 0) throw new Error('renderSid_poke.js failed');
  if (!fs.existsSync(sidOut)) throw new Error('.sid not produced');

  // *** Important: pass BASENAME (no .wav) ***
  const wavPath = renderRoomMusic(sidOut, path.join(SID_DIR, 'current_room'), lengthSec);

  return { wavUrl: `/sid/current_room.wav?ts=${Date.now()}`, jsonPath, sidOut, wavOut: wavPath };
}

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

function parseNpcPartyNamesFromConsole(consoleText = '') {
  const block = consoleText.match(
    /NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited|Objects in Room|Exits|$))/
  )?.[1] || '';
  const re = /^([^,\n]+)\s*,/gm;
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    const nm = (m[1] || '').trim();
    if (nm && !/^none$/i.test(nm)) out.push(nm);
  }
  return [...new Set(out)];
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
async function retortWithUserInput(userInput, broadcast, combatMode = sharedState.getCombatMode()) {
  console.log('Received combatMode in retortWithUserInput:', combatMode);
  const dungeonTestingMode = sharedState.getDungeonTestingMode && sharedState.getDungeonTestingMode();
  let personalNarrative = '';
  if (!dungeonTestingMode) {
    personalNarrative = await getDelayedPersonalNarrative();
  }
    // Use the function to delay fetching the updatedGameConsole
  let updatedGameConsole = await getDelayedUpdatedGameConsole();
  let roomNameDatabaseString = await getDelayedRoomNameDatabase();

  if (dungeonTestingMode) {
    console.log('Dungeon testing mode enabled; running dungeon-only pipeline.');
    return run(retort(async ($) => runDungeonTestingMode($, updatedGameConsole, roomNameDatabaseString, broadcast)));
  }

  let dialogueParts = personalNarrative.split('\n');
  let narrative = ``;
  
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
  return `${coordinates.x},${coordinates.y},${coordinates.z}`;
}

function normalizeCoordKey(key) {
  if (key == null) return "0,0,0";

  // If we were passed a coords object, use the existing canonical formatter.
  if (typeof key === "object") return coordinatesToString(key);

  const raw = String(key).trim();

  // Already canonical: "x,y,z"
  {
    const m = raw.match(/^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)$/);
    if (m) return `${parseInt(m[1], 10)},${parseInt(m[2], 10)},${parseInt(m[3], 10)}`;
  }

  // Console/LLM style: "X:1, Y:0, Z:0" (optionally preceded by "Coordinates:")
  {
    const m = raw.match(/^(?:Coordinates:\s*)?X:\s*(-?\d+)\s*,\s*Y:\s*(-?\d+)\s*,\s*Z:\s*(-?\d+)\s*$/i);
    if (m) return `${parseInt(m[1], 10)},${parseInt(m[2], 10)},${parseInt(m[3], 10)}`;
  }

  return raw;
}

// Wrapper for safe access/update
function getRoomSafe(db, key) {
  const normKey = normalizeCoordKey(key);
  return db[normKey] || null;
}

function setRoomSafe(db, key, room) {
  const normKey = normalizeCoordKey(key);
  db[normKey] = room;

  // Only delete the old key if it's actually different.
  const rawKey = (key == null) ? null : String(key);
  if (rawKey && rawKey !== normKey && Object.prototype.hasOwnProperty.call(db, rawKey)) {
    delete db[rawKey];
  }

  return normKey;
}

// Updated generateDefaultClassification: Avoids retort-js schema issues by using .json() with minimal schema.
// Final updated generateDefaultClassification: Bypasses schema entirely with plain .assistant and manual JSON parse.
// This avoids retort-js schema bugs while keeping LLM for variety.
async function generateDefaultClassification($, currentRoom = null, isSideChamber = false) {
  // Inherit from currentRoom if possible
  if (currentRoom && currentRoom.classification) {
    return { ...currentRoom.classification }; // Shallow copy
  }

  // Default: Indoor temple (safe for side chambers/unvisited)
  const base = {
    indoor: true,
    size: 16, // Small for sides
    biome: "temple",
    features: ["pillars"], // Minimal
    skyTop: "#FFDD88",
    skyBot: "#AA4400",
    floorColor: "#442200",
    wallColor: "#8B4513"
  };

  if (!isSideChamber) {
    // LLM-generate for outdoor/exploration
    $.model = "gpt-4o-mini";
    $.temperature = 0.7;
    await $.user`Generate a brief room classification for a new underworld room. Respond ONLY with valid JSON object, no extra text: {"indoor": true or false, "size": number between 16-64, "biome": string like 'wasteland', "features": array of 1-3 strings like ["pillars"], "skyTop": hex like '#FFDD88', "skyBot": hex like '#AA4400', "floorColor": hex like '#442200', "wallColor": hex like '#8B4513'}. Base on wasteland/temple theme.`;

    // Plain assistant call, no schema/parameters
    try {
      const response = await $.assistant.generation();
      const content = (response && response.content) ? response.content : '';

      // Extract JSON (trim any leading/trailing text if needed)
      const jsonMatch = content.match(/\{[\s\S]*\}/); // Grab first {} block
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Sanitize: Ensure required fields, fallback to base
        const safe = {
          indoor: typeof parsed.indoor === 'boolean' ? parsed.indoor : base.indoor,
          size: (Number.isInteger(parsed.size) && parsed.size >= 16 && parsed.size <= 64) ? parsed.size : base.size,
          biome: typeof parsed.biome === 'string' ? parsed.biome : base.biome,
          features: Array.isArray(parsed.features) && parsed.features.length >= 1 && parsed.features.length <= 3
            ? parsed.features.filter(f => typeof f === 'string')
            : base.features,
          skyTop: typeof parsed.skyTop === 'string' && /^#[0-9A-Fa-f]{6}$/.test(parsed.skyTop) ? parsed.skyTop : base.skyTop,
          skyBot: typeof parsed.skyBot === 'string' && /^#[0-9A-Fa-f]{6}$/.test(parsed.skyBot) ? parsed.skyBot : base.skyBot,
          floorColor: typeof parsed.floorColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(parsed.floorColor) ? parsed.floorColor : base.floorColor,
          wallColor: typeof parsed.wallColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(parsed.wallColor) ? parsed.wallColor : base.wallColor
        };
        return safe;
      }
    } catch (err) {
      console.warn('LLM response parse failed in generateDefaultClassification:', err);
    }
  }

  return base;
}

// Ensure every room in DB has classification (call after updates)
function ensureAllRoomsClassified(db, currentRoomKey = null) {
  for (const [key, room] of Object.entries(db)) {
    if (!room.classification) {
      // Async? For sync, use default; else await generateDefaultClassification(null, room)
      room.classification = {
        indoor: true, // Default safe
        size: 16,
        biome: "temple",
        features: [],
        skyTop: "#FFDD88",
        skyBot: "#AA4400",
        floorColor: "#442200",
        wallColor: "#8B4513"
      };
      room.indoor = room.classification.indoor;
      room.isIndoor = room.indoor;
      room.isOutdoor = !room.indoor;
    }
  }
  // Persist
  sharedState.setRoomNameDatabase(JSON.stringify(db));
  return db;
}

// Helper function to generate a key with properties and a unique name
async function generateKey($, coordinates, direction) {
  $.model = "gpt-4.1-mini";
  $.temperature = 1.0;
  await $.user`Provide the name and modifiers for a key for a locked door at coordinates ${coordinatesToString(coordinates)} in the direction "${direction}". Respond with ONLY the JSON object in the format: {"name": "Key Name", "type": "key", "attack_modifier": W, "damage_modifier": X, "ac": Y, "magic": Z} where "Key Name" is a simple, unique name (e.g., "Skeleton Key", "Iron Key") and W, X, Y, Z are numbers 0, 1, 2, or 3. Do not include any other text, explanations, or comments before or after the JSON.`;
  const keyResult = await $.assistant.generation({
    parameters: {
      name: {type: String},
      type: {type: String, enum: ["key"]},
      attack_modifier: {type: Number, enum: [0, 1, 2, 3]},
      damage_modifier: {type: Number, enum: [0, 1, 2, 3]},
      ac: {type: Number, enum: [0, 1, 2, 3]},
      magic: {type: Number, enum: [0, 1, 2, 3]}
    }
  });
  console.log(`Key result (raw): ${JSON.stringify(keyResult)}`);
  const keyData = keyResult.result || {};
  return {
    name: (keyData.name || `Key for ${direction} at ${coordinatesToString(coordinates)}`).toLowerCase(),
    type: keyData.type || "key",
    properties: {
      attack: keyData.attack_modifier || 0,
      damage: keyData.damage_modifier || 0,
      ac: keyData.ac || 0,
      magic: keyData.magic || 0
    }
  };
}

// Opposite direction map for making reciprocal exits on new rooms
const OPPOSITE = {
  north: "south", south: "north",
  east: "west", west: "east",
  northeast: "southwest", southwest: "northeast",
  northwest: "southeast", southeast: "northwest",
  up: "down", down: "up"
};

// Helper function to place a key in a room (prefer nearby reachable room; unless hostile -> same room).
// If no suitable adjacent room exists, we create a tiny side room and wire open exits.
async function placeKey($, coordinates, lockedDirection, key, roomNameDatabasePlain) {
  const currentRoomKey = coordinatesToString(coordinates);
  let currentRoom = getRoomSafe(roomNameDatabasePlain, currentRoomKey) || { objects: [], exits: {} };

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
    down: { x: 0, y: 0, z: -1 }
  };

  // Room behind the locked exit (avoid placing the key there)
  let lockedTargetKey = null;
  {
    const delta = directionMap[lockedDirection];
    if (delta) {
      const lockedTarget = { x: coordinates.x + delta.x, y: coordinates.y + delta.y, z: coordinates.z + delta.z };
      lockedTargetKey = coordinatesToString(lockedTarget);
    }
  }

  // Hostiles? Keep key in current room (design rule).
  const preferCurrentRoom = hasHostileMonsters(currentRoom);
  let targetRoomKey = currentRoomKey;

  if (!preferCurrentRoom) {
    // 1) try existing adjacent, reachable rooms (not behind the locked exit)
    const candidates = [];
    for (const [dir, offset] of Object.entries(directionMap)) {
      const adj = { x: coordinates.x + offset.x, y: coordinates.y + offset.y, z: coordinates.z + offset.z };
      const adjKey = coordinatesToString(adj);
      if (adjKey === lockedTargetKey) continue;
      const adjRoom = getRoomSafe(roomNameDatabasePlain, adjKey);
      // reachable = currentRoom has the exit and it's open OR there's no explicit exit (treat as open path)
      const e = currentRoom.exits ? currentRoom.exits[dir] : null;
      const status = String(e?.status || "open").toLowerCase();
      const reachable = (status === "open");
      if (adjRoom && reachable) candidates.push(adjKey);
    }
    if (candidates.length > 0) {
      targetRoomKey = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // 2) create a small side chamber in a free adjacent direction (not behind the locked door)
      const freeDir = Object.keys(directionMap).find(dir => {
        if (dir === lockedDirection) return false;
        const offset = directionMap[dir];
        const cand = { x: coordinates.x + offset.x, y: coordinates.y + offset.y, z: coordinates.z + offset.z };
        const candKey = coordinatesToString(cand);
        return candKey !== lockedTargetKey && !getRoomSafe(roomNameDatabasePlain, candKey);
      });
      if (freeDir) {
        const off = directionMap[freeDir];
        const newAdj = { x: coordinates.x + off.x, y: coordinates.y + off.y, z: coordinates.z + off.z };
        targetRoomKey = coordinatesToString(newAdj);
        // NEW: Generate with classification (inherit from current)
        const classification = await generateDefaultClassification($, currentRoom, true /* side chamber */);
        // Make the new side room
        roomNameDatabasePlain[targetRoomKey] = {
          name: "Side Chamber of Hollow Echoes",
          exhaustionLimit: 4,
          attemptedSearches: 0,
          trapTriggered: false,
          exits: {},
          objects: [],
          indoor: classification.indoor,
          classification,
          isIndoor: classification.indoor,
          isOutdoor: !classification.indoor,
          monsters: { inRoom: "None", equippedProperties: "None", state: "None" } // Default
        };
        // Wire up open exits both ways
        currentRoom.exits = currentRoom.exits || {};
        currentRoom.exits[freeDir] = {
          status: "open",
          targetCoordinates: targetRoomKey,
          key: null
        };
        roomNameDatabasePlain[targetRoomKey].exits[OPPOSITE[freeDir]] = {
          status: "open",
          targetCoordinates: currentRoomKey,
          key: null
        };
        // persist currentRoom back (since we mutated it)
        setRoomSafe(roomNameDatabasePlain, currentRoomKey, currentRoom);
      } else {
        // 3) total fallback: keep in current room (no free direction found)
        targetRoomKey = currentRoomKey;
      }
    }
  }

  // Add the key to the chosen room
  let targetRoom = getRoomSafe(roomNameDatabasePlain, targetRoomKey) || {
    name: "Unnamed Room",
    exhaustionLimit: null,
    attemptedSearches: 0,
    trapTriggered: false,
    exits: {},
    objects: []
  };
  targetRoom.objects = targetRoom.objects || [];
  targetRoom.objects.push({
    name: key.name,
    type: key.type,
    properties: key.properties,
    unlocks: { coordinates: coordinatesToString(coordinates), direction: lockedDirection }
  });
  setRoomSafe(roomNameDatabasePlain, targetRoomKey, targetRoom);

  // NEW: Ensure all rooms classified after mutation
  ensureAllRoomsClassified(roomNameDatabasePlain, currentRoomKey);

  // DEV log (server log)
  console.log(`[key] placed "${key.name}" at ${targetRoomKey} to unlock ${coordinatesToString(coordinates)} ${lockedDirection}`);
  return { roomKey: targetRoomKey, keyName: key.name };
}

// Helper function to select a random exit status
async function selectExitStatus($) {
  $.model = "gpt-4.1-mini";
  $.temperature = 1.0;
  await $.user`Choose one of the following exit statuses: locked, blocked, barricaded, sealed. Respond with ONLY the JSON object in the format: {"status": "chosen_status"} where "chosen_status" is one of the options. Do not include any other text, explanations, or comments before or after the JSON.`;
  const statusResult = await $.assistant.generation({
    parameters: {
      status: {type: String, enum: ["locked", "blocked", "barricaded", "sealed"]}
    }
  });
  console.log(`Status result (raw): ${JSON.stringify(statusResult)}`);
  const statusData = statusResult.result || {};
  return statusData.status || "locked"; // Default to "locked" if failed
}

// Drop-in replacement for syncKeysOnRoomEntry. Assumes helpers (getRoomSafe, setRoomSafe, ensureAllRoomsClassified) are added elsewhere.
async function syncKeysOnRoomEntry($, coordinates, roomNameDatabasePlain, updatedGameConsole) {
  const coordKey = coordinatesToString(coordinates);
  let currentRoom = getRoomSafe(roomNameDatabasePlain, coordKey) || { objects: [] };
  // Gather room keys that declare an unlock target
  const keys = (currentRoom.objects || []).filter(obj => obj.type === "key" && obj.unlocks);
  if (keys.length > 0) {
    // ========== SYNC EXIT KEYS (NEW) ==========
    // Ensure the room has an exits object we can write into
    currentRoom.exits = currentRoom.exits || {};
    for (const keyObj of keys) {
      const dir = keyObj.unlocks?.direction;
      const target = keyObj.unlocks?.coordinates;
      if (!dir || !target) continue;
      const exit = currentRoom.exits[dir];
      // If this room already has an exit in that direction pointing to the same target room
      if (exit && exit.targetCoordinates === target) {
        // If the exit is sealed/locked but missing the key name, add it now
        if (!exit.key && exit.status !== "open") {
          currentRoom.exits[dir].key = keyObj.name;
        }
      }
    }
    // Persist the updated room and whole map back to shared state
    setRoomSafe(roomNameDatabasePlain, coordKey, currentRoom);
    ensureAllRoomsClassified(roomNameDatabasePlain, coordKey);
    // ==========================================
    // --- your existing UI sync for Objects / Properties ---
    let objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
    let objectsInRoom = objectsInRoomMatch && objectsInRoomMatch[1]
      ? objectsInRoomMatch[1].split(', ').map(item => item.trim())
      : [];
    let objectPropertiesMatch = updatedGameConsole.match(/Objects in Room Properties: ([^\n]+)/);
    let objectPropertiesArray = objectPropertiesMatch && objectPropertiesMatch[1].trim().toLowerCase() !== "none"
      ? objectPropertiesMatch[1].split('}, {').map(obj => `{${obj.replace(/^{|}$/g, '')}}`)
      : [];
    let keysAdded = new Set(); // Track added keys to avoid duplicates
    for (const key of keys) {
      if (!objectsInRoom.includes(key.name) && !keysAdded.has(key.name)) {
        objectsInRoom.push(key.name);
        objectPropertiesArray.push(`{name: "${key.name}", type: "${key.type}", attack_modifier: ${key.properties.attack || 0}, damage_modifier: ${key.properties.damage || 0}, ac: ${key.properties.ac || 0}, magic: ${key.properties.magic || 0}}`);
        keysAdded.add(key.name);
      }
    }
    if (objectsInRoom.length > 0) {
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room: [^\n]+/, `Objects in Room: ${objectsInRoom.join(', ')}`);
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: [^\n]+/, `Objects in Room Properties: ${objectPropertiesArray.join(', ')}`);
    } else {
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room: [^\n]+/, `Objects in Room: None`);
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: [^\n]+/, `Objects in Room Properties: None`);
    }
  }
  return updatedGameConsole;
}

// Drop-in replacement for syncMonstersOnRoomEntry. Assumes helpers (getRoomSafe, setRoomSafe, ensureAllRoomsClassified) are added elsewhere.
async function syncMonstersOnRoomEntry($, coordinates, roomNameDatabasePlain, updatedGameConsole) {
  const coordKey = coordinatesToString(coordinates);
  let currentRoom = getRoomSafe(roomNameDatabasePlain, coordKey) || { monsters: { inRoom: "None", equippedProperties: "None", state: "None" } };
  const dbMonsters = currentRoom.monsters || { inRoom: "None", equippedProperties: "None", state: "None" };
  // Gather monsters from database
  if (dbMonsters.inRoom !== "None") {
    // Sync to console if missing or mismatched
    let monstersInRoomMatch = updatedGameConsole.match(/Monsters in Room: ([^\n]+)/);
    let monstersInRoom = monstersInRoomMatch ? monstersInRoomMatch[1].trim() : "None";
   
    let monstersEquippedMatch = updatedGameConsole.match(/Monsters Equipped Properties: ([^\n]+)/);
    let monstersEquipped = monstersEquippedMatch ? monstersEquippedMatch[1].trim() : "None";
   
    let monstersStateMatch = updatedGameConsole.match(/Monsters State: ([^\n]+)/);
    let monstersState = monstersStateMatch ? monstersStateMatch[1].trim() : "None";
    // Update if database has data not in console
    if (monstersInRoom === "None" || monstersInRoom !== dbMonsters.inRoom) {
      monstersInRoom = dbMonsters.inRoom;
      monstersEquipped = dbMonsters.equippedProperties;
      monstersState = dbMonsters.state;
     
      // Persist the updated room back to database (for consistency, though usually console follows db)
      currentRoom.monsters = { inRoom: monstersInRoom, equippedProperties: monstersEquipped, state: monstersState };
      setRoomSafe(roomNameDatabasePlain, coordKey, currentRoom);
      ensureAllRoomsClassified(roomNameDatabasePlain, coordKey);
    }
    // Update console fields
    updatedGameConsole = updatedGameConsole.replace(/Monsters in Room: [^\n]+/, `Monsters in Room: ${monstersInRoom}`);
    updatedGameConsole = updatedGameConsole.replace(/Monsters Equipped Properties: [^\n]+/, `Monsters Equipped Properties: ${monstersEquipped}`);
    updatedGameConsole = updatedGameConsole.replace(/Monsters State: [^\n]+/, `Monsters State: ${monstersState}`);
  }
  return updatedGameConsole;
}

// Drop-in replacement for syncObjectsOnRoomEntry. Assumes helpers (getRoomSafe, ensureAllRoomsClassified) are added elsewhere.
// Note: This function doesn't mutate the DB, but we ensure classification for consistency.
async function syncObjectsOnRoomEntry($, coordinates, roomNameDatabasePlain, updatedGameConsole) {
  const coordKey = coordinatesToString(coordinates);
  const room = getRoomSafe(roomNameDatabasePlain, coordKey);
  if (!room) return updatedGameConsole;
  const dbObjs = Array.isArray(room.objects) ? room.objects : [];
  // --- read existing console lines (if present) ---
  const namesMatch = updatedGameConsole.match(/^\s*Objects in Room:\s*([^\n]+)/m);
  const propsMatch = updatedGameConsole.match(/^\s*Objects in Room Properties:\s*([^\n]+)/m);
  const existingNames = (namesMatch && namesMatch[1] && namesMatch[1].trim().toLowerCase() !== "none")
    ? namesMatch[1].split(",").map(s => s.trim()).filter(Boolean)
    : [];
  // Parse props into a map keyed by name -> {type, attack, damage, ac, magic}
  const existingPropsByName = {};
  if (propsMatch && propsMatch[1] && propsMatch[1].trim().toLowerCase() !== "none") {
    // Split objects of the form { ... }, { ... }, ...
    const raw = propsMatch[1];
    const chunks = raw.split(/}\s*,\s*{/g).map((c, i, arr) => {
      if (i === 0 && !c.startsWith("{")) c = "{" + c;
      if (i === arr.length - 1 && !c.endsWith("}")) c = c + "}";
      if (!c.startsWith("{")) c = "{" + c;
      if (!c.endsWith("}")) c = c + "}";
      return c;
    });
    for (const ch of chunks) {
      const nameM = ch.match(/name:\s*"(.*?)"/);
      const typeM = ch.match(/type:\s*"(.*?)"/);
      const atkM = ch.match(/attack_modifier:\s*(-?\d+)/);
      const dmgM = ch.match(/damage_modifier:\s*(-?\d+)/);
      const acM = ch.match(/ac:\s*(-?\d+)/);
      const magM = ch.match(/magic:\s*(-?\d+)/);
      const nm = nameM ? nameM[1] : null;
      if (!nm) continue;
      existingPropsByName[nm] = {
        type: typeM ? typeM[1] : "other",
        attack: atkM ? Number(atkM[1]) : 0,
        damage: dmgM ? Number(dmgM[1]) : 0,
        ac: acM ? Number(acM[1]) : 0,
        magic: magM ? Number(magM[1]) : 0
      };
    }
  }
  // --- union of names (console + DB) ---
  const dbNames = dbObjs.map(o => o?.name).filter(Boolean);
  const allNames = [...new Set([...existingNames, ...dbNames])];
  // --- build props preferring DB, fallback console, else zeros ---
  const propsList = allNames.map(nm => {
    const dbObj = dbObjs.find(o => (o?.name === nm));
    const type = dbObj?.type ?? existingPropsByName[nm]?.type ?? "other";
    const p = dbObj?.properties ?? existingPropsByName[nm] ?? {};
    const attack = (p.attack ?? 0);
    const damage = (p.damage ?? 0);
    const ac = (p.ac ?? 0);
    const magic = (p.magic ?? 0);
    return `{name: "${nm}", type: "${type}", attack_modifier: ${attack}, damage_modifier: ${damage}, ac: ${ac}, magic: ${magic}}`;
  });
  // --- write back (non-destructive: we rebuild the two lines only) ---
  const objectsLine = `Objects in Room: ${allNames.length ? allNames.join(', ') : 'None'}`;
  const propsLine = `Objects in Room Properties: ${propsList.length ? propsList.join(', ') : 'None'}`;
  if (/^\s*Objects in Room:\s*[^\n]*/m.test(updatedGameConsole)) {
    updatedGameConsole = updatedGameConsole.replace(/^\s*Objects in Room:\s*[^\n]*/m, objectsLine);
  } else {
    updatedGameConsole = (updatedGameConsole + '\n' + objectsLine).trim();
  }
  if (/^\s*Objects in Room Properties:\s*[^\n]*/m.test(updatedGameConsole)) {
    updatedGameConsole = updatedGameConsole.replace(/^\s*Objects in Room Properties:\s*[^\n]*/m, propsLine);
  } else {
    updatedGameConsole = (updatedGameConsole + '\n' + propsLine).trim();
  }

  // NEW: Ensure classification for this room (even if no mutation, for consistency)
  ensureAllRoomsClassified(roomNameDatabasePlain, coordKey);

  return updatedGameConsole;
}


function hasHostileMonsters(room) {
  if (!room) return false;

  // Common shapes we’ve seen in your data
  const stateFields = [
    room.monstersState,
    room.monsters_state,
    room.stateOfMonsters
  ].filter(Boolean).join(" ").toLowerCase();

  if (stateFields.includes("hostile") || stateFields.includes("aggressive") || stateFields.includes("violent")) {
    return true;
  }

  const arr = Array.isArray(room.monsters) ? room.monsters : [];
  for (const m of arr) {
    const s = String(m?.state || m?.attitude || m?.disposition || "").toLowerCase();
    if (["hostile", "aggressive", "violent", "enemy"].includes(s)) return true;
    if (typeof m?.hostility === "number" && m.hostility > 0) return true;
  }
  return false;
}

// Helper function to parse coordinates string to object
function parseCoordinates(coordString) {
  const [x, y, z] = coordString.split(",").map(Number);
  return { x, y, z };
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

// NEW: Function to generate or load room-specific music JSON
async function getOrGenerateRoomMusic($, coords, roomDescription, monstersInRoom) {
  const c   = normalizeCoords(coords);
  const key = coordsKey(c);

  try {
    // Cache first
    let musicJson = sharedState.getRoomMusic(c);
    if (!musicJson) {
      // Generate fresh if missing
      const generated = await generateSidArrangement($, roomDescription, monstersInRoom, key);
      if (!generated) throw new Error('generateSidArrangement returned empty/undefined');

      sharedState.setRoomMusic(c, generated);
      musicJson = generated;
      console.log(`Generated and stored music for room ${key}`);
    } else {
      console.log(`Loaded existing music for room ${key}`);
    }

    // Always refresh "latest" outputs and WAV
    const { wavUrl } = writeLatestJsonAndRender(musicJson);

    return { musicJson, wavUrl, isNew: !sharedState.getRoomMusicWasHit, key, coords: c };
  } catch (err) {
    console.error(`getOrGenerateRoomMusic failed for ${key}:`, err);
    throw err;
  }
}

function coordsKey(c){ return `${c?.x??0},${c?.y??0},${c?.z??0}`; }

// --- DROP-IN REPLACEMENT ---
// Strict, enum-only LLM composition with sections (intro/development/cadence).
// Forces the model to choose EVERY event (no defaults), and we reject if invalid.
// Expects retort-js `$` runner. Returns a JSON arrangement your renderer accepts
// (using patternSections that your renderer already flattens).

// --- DROP-IN REPLACEMENT: generateSidArrangement with a tiny compiler step ---
// Requires retort-js `$` runner. Produces enum-only patternSections (intro/dev/cadence).

// ---------- tiny helper ----------
function hashSeed(str) {
  let h = 0x811c9dc5 >>> 0; // FNV-1a 32-bit
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h>>>0).toString(16).padStart(8,'0');
}
function seedFrom(source) {
  const s = (typeof source === 'string') ? source : JSON.stringify(source ?? {});
  return hashSeed(s);
}

// === DROP-IN REPLACEMENT ===
// Strict, incremental composer that forces the LLM to choose EVERY enum,
// validates at each micro-step, and compiles to key/scale.
// Place in retort/retortWithUserInput.js (replace your current generateSidArrangement).

// === DROP-IN generateSidArrangement (enum-only, section-by-section, no code fallback) ===
// ---------- DROP-IN: generateSidArrangement (no $.tool schemas) ----------
// DROP-IN REPLACEMENT
// retortWithUserInput.js (or wherever you define this)
// DROP-IN REPLACEMENT
// retortWithUserInput.js (or wherever you define this)
async function generateSidArrangement($, variationToken, roomContext = {}) {
  // ---------- CONFIG ----------
  const BPM_ALLOWED      = [96, 104, 112, 120, 128, 136, 144];
  const SCALES_ALLOWED   = ["dorian", "phrygian", "minor"]; // lower-case only
  const KEYS_SHARPS      = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const NOTES_ALLOWED    = ["REST", ...KEYS_SHARPS];
  const OCTAVES_ALLOWED  = [2,3,4,5];
  const DUR_ALLOWED      = [16,8,4];

  // Mode degrees (semitones above tonic)
  const MODES = {
    dorian:   [0,2,3,5,7,9,10],
    phrygian: [0,1,3,5,7,8,10],
    minor:    [0,2,3,5,7,8,10]
  };

  // Section rules
  const RULES = {
    LEAD: { min8: 6, min4: 2, max16: 8, minRests: 2 },
    BASS: { min8: 8, min4: 2, max16: 6, minRests: 0 },
    ARP:  { min8: 6, min4: 1, max16:10, minRests: 0 }
  };

  // Renderer’s discrete sets (snap to these)
  const RENDER_ALLOWED = {
    PW:     [0,128,256,384,512,640,768,896,1024,1152,1280,1536,1792,2048,2304,2560,2816,3072,3328,3584,3840,3968,4095],
    FILT_C: [128,256,384,512,640,768,896,1024,1280,1536,1792],
    RES:    [0,2,4,6,8,10,12,15],
    FILT_T: ["NONE","LP","BP","HP","LP+BP","HP+BP"]
  };

  // ---------- HELPERS ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function assert(c, m){ if(!c) throw new Error(m); }
  const pitchToSemitone = p => KEYS_SHARPS.indexOf(p);

  function nearestInList(n, arr){
    if (!Array.isArray(arr) || !arr.length) return n;
    let best = arr[0], bestd = Math.abs(n - best);
    for (const a of arr){ const d = Math.abs(n-a); if (d<bestd){ best=a; bestd=d; } }
    return best;
  }

  function allowedNotesFor(key, scale){
    const tonic = KEYS_SHARPS.indexOf(key);
    return MODES[scale].map(d => KEYS_SHARPS[(tonic + d) % 12]);
  }

  function countDurations(steps){
    let c16=0,c8=0,c4=0,rests=0;
    for(const s of steps||[]){
      if (s.duration===16) c16++;
      else if (s.duration===8) c8++;
      else if (s.duration===4) c4++;
      if (s.note==="REST") rests++;
    }
    return { c16,c8,c4,rests };
  }

  function nearestModeNoteName(note, key, scale){
    if (note==="REST") return "REST";
    const allowed = allowedNotesFor(key, scale);
    const n = KEYS_SHARPS.indexOf(note);
    let best = allowed[0], bestDist = 12, bestSigned = 0;
    for (const a of allowed){
      const m = KEYS_SHARPS.indexOf(a);
      let d = m - n; if (d > 6) d -= 12; if (d < -6) d += 12;
      const ad = Math.abs(d);
      if (ad < bestDist || (ad === bestDist && d > bestSigned)) { bestDist = ad; best = a; bestSigned = d; }
    }
    return best;
  }

  function validate16Steps(steps, {role, key, scale, allowChromatic, rules}) {
    const problems = [];
    if (!Array.isArray(steps) || steps.length !== 16) {
      problems.push(`must have EXACTLY 16 steps, got ${Array.isArray(steps)?steps.length:'invalid'}`);
      return { problems, metrics: null, outOfScaleIdxs: [] };
    }
    const allowed = new Set(allowedNotesFor(key, scale));
    let c16=0,c8=0,c4=0,rests=0; const outOfScaleIdxs=[];
    for (let i=0;i<steps.length;i++){
      const s = steps[i];
      if (typeof s!=="object"){ problems.push(`step ${i+1} not an object`); continue; }
      const { note, octave, duration } = s;
      if (!NOTES_ALLOWED.includes(note)) problems.push(`step ${i+1} note invalid: ${note}`);
      if (note!=="REST" && !OCTAVES_ALLOWED.includes(octave)) problems.push(`step ${i+1} octave invalid: ${octave}`);
      if (!DUR_ALLOWED.includes(duration)) problems.push(`step ${i+1} duration invalid: ${duration}`);
      if (duration===16) c16++; else if (duration===8) c8++; else if (duration===4) c4++;
      if (note==="REST") rests++;
      if (note!=="REST" && !allowed.has(note)) outOfScaleIdxs.push(i+1);
    }
    if (c8 < rules.min8)   problems.push(`needs >=${rules.min8} eighths, got ${c8}`);
    if (c4 < rules.min4)   problems.push(`needs >=${rules.min4} quarters, got ${c4}`);
    if (c16 > rules.max16) problems.push(`needs <=${rules.max16} sixteenths, got ${c16}`);
    if (role==="LEAD" && rests < rules.minRests) problems.push(`LEAD needs >=${rules.minRests} RESTs, got ${rests}`);
    if (outOfScaleIdxs.length > allowChromatic) problems.push(`too many out-of-scale tones: ${outOfScaleIdxs.length} (max ${allowChromatic})`);
    return { problems, metrics:{c16,c8,c4,rests}, outOfScaleIdxs };
  }

  function coerce16Steps(steps, { role, key, scale, rules }){
    const allowedSet = new Set(allowedNotesFor(key, scale));
    const norm = Array.isArray(steps) ? steps.map(s=>{
      const note = NOTES_ALLOWED.includes(s?.note) ? s.note : "REST";
      const octave = note==="REST" ? 0 : (OCTAVES_ALLOWED.includes(s?.octave)?s.octave:3);
      const duration = DUR_ALLOWED.includes(s?.duration) ? s.duration : 8;
      return { note, octave, duration };
    }) : [];
    let fixed = norm.slice(0,16); while (fixed.length<16) fixed.push({note:"REST",octave:0,duration:8});

    // Snap out-of-scale to mode
    for (const s of fixed){ if (s.note!=="REST" && !allowedSet.has(s.note)) s.note = nearestModeNoteName(s.note, key, scale); }

    // Rhythm compliance
    let { c16,c8,c4,rests } = countDurations(fixed);
    for (const idx of [3,11,7,15]) { // ensure quarters
      if (c4>=rules.min4) break;
      if (fixed[idx].duration!==4) { fixed[idx].duration=4; c4++; if (fixed[idx].duration===16) c16--; else c8--; }
    }
    ({ c16,c8,c4,rests } = countDurations(fixed));
    for (const idx of [1,5,9,13,0,2,4,6,8,10,12,14]) { // ensure eighths
      if (c8>=rules.min8) break;
      if (fixed[idx].duration===16) { fixed[idx].duration=8; c8++; c16--; }
    }
    ({ c16,c8,c4,rests } = countDurations(fixed));
    for (const idx of [2,6,10,14,0,1,3,4,5,7,8,9,11,12,13,15]) { // max sixteenths
      if (c16<=rules.max16) break;
      if (fixed[idx].duration===16) { fixed[idx].duration=8; c16--; c8++; }
    }
    // LEAD rest requirement (already okay for BASS/ARP)
    if (role==="LEAD" && rests < RULES.LEAD.minRests){
      for (const idx of [4,12,8,0,6,14]){
        if (rests>=RULES.LEAD.minRests) break;
        if (fixed[idx].note!=="REST"){ fixed[idx]={note:"REST",octave:0,duration:8}; rests++; }
      }
    }
    // Final snap
    for (const s of fixed){ if (s.note!=="REST" && !allowedSet.has(s.note)) s.note = nearestModeNoteName(s.note, key, scale); }
    return fixed;
  }

  async function askJsonStrict(prompt, {maxRetries=4, fixLabel="FIX:"}={}){
    let lastErr="";
    for (let attempt=0; attempt<=maxRetries; attempt++){
      $.user(prompt + (lastErr ? `\n${fixLabel}\n${lastErr}\nReturn ONLY JSON.` : "\nReturn ONLY JSON."));
      const reply = await $.assistant.generation();
      const raw = (reply && reply.content || "").trim();
      const jsonStr = (()=>{ // allow fenced JSON fallback
        try {
          if (raw.startsWith("{") || raw.startsWith("[")) return raw;
          const m = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); return m?m[1]:raw;
        } catch { return raw; }
      })();
      try { return JSON.parse(jsonStr); }
      catch(e){ lastErr = `Respond with valid JSON only. Error: ${e.message}`; await sleep(60); }
    }
    throw new Error("Failed to get valid JSON after retries");
  }

  // ---------- HEADER (with casing guard) ----------
  $.system(`You are a medieval/renaissance-leaning SID composer for a Tartarus-afterlife game.
Return only strict JSON when asked. Never include commentary.`);

  const header = await askJsonStrict(
    [
      `Choose header for a solemn/heroic Tartarus-afterlife 4/4 loop (variation token ${variationToken}).`,
      `- Use darker modes (dorian/phrygian/minor) when appropriate.`,
      `- BPM must be one of: ${BPM_ALLOWED.join(", ")}.`,
      `- IMPORTANT: "scale" must be one of these strings in LOWERCASE exactly: ${SCALES_ALLOWED.join(", ")}.`,
      `Return ONLY JSON as {"bpm":<int>,"key":"<sharp-key>","scale":"<mode>"}.`
    ].join("\n")
  );

  let bpm   = header?.bpm;
  let key   = (header?.key||"").toUpperCase();
  let scale = (header?.scale||"").toLowerCase();

  if (!SCALES_ALLOWED.includes(scale)) scale = "phrygian"; // safe default
  if (!BPM_ALLOWED.includes(bpm))      bpm   = 112;
  if (!KEYS_SHARPS.includes(key))      key   = "D#";

  // ---------- STYLE PRESETS (classic C64-ish) ----------
  // We avoid NOISE entirely. Pulse for musicality, Tri for glassy arps.
  const STYLE_BANK = {
    // brooding / dungeon (Hillsfar-like)
    "dungeon_pulse": {
      LEAD: { waveform:"PULSE", PW:2048, AD:[0,9], SR:[10,3], FILT:{type:"LP+BP", cut:1024, res:6} },
      BASS: { waveform:"PULSE", PW:1536, AD:[0,9], SR:[8,2],  FILT:{type:"LP",   cut:896,  res:4} },
      ARP:  { waveform:"TRI",   PW:0,    AD:[0,6], SR:[4,3],  FILT:{type:"BP",   cut:1024, res:6} }
    },
    // action / comic (Batman-like)
    "heroic_driver": {
      LEAD: { waveform:"PULSE", PW:2304, AD:[1,8], SR:[10,3], FILT:{type:"LP+BP", cut:1280, res:8} },
      BASS: { waveform:"PULSE", PW:1280, AD:[0,9], SR:[7,2],  FILT:{type:"LP",    cut:1024, res:6} },
      ARP:  { waveform:"PULSE", PW:1792, AD:[0,5], SR:[3,3],  FILT:{type:"NONE",  cut:512,  res:0} }
    },
    // epic fantasy (Azure Bonds-like)
    "epic_minor": {
      LEAD: { waveform:"PULSE", PW:2048, AD:[0,9], SR:[11,2], FILT:{type:"LP+BP", cut:1024, res:6} },
      BASS: { waveform:"TRI",   PW:0,    AD:[0,8], SR:[6,2],  FILT:{type:"LP",    cut:768,  res:4} },
      ARP:  { waveform:"TRI",   PW:0,    AD:[0,6], SR:[4,3],  FILT:{type:"BP",    cut:896,  res:6} }
    }
  };

  // pick a preset based on scale
  const presetKey = (scale==="phrygian") ? "dungeon_pulse" : (scale==="minor" ? "epic_minor" : "heroic_driver");
  const PRESET = STYLE_BANK[presetKey];

  // Snap to renderer’s discrete values
  function snapF(p){
    const o = { ...p };
    o.PW = nearestInList(o.PW, RENDER_ALLOWED.PW);
    o.FILT = {
      type: (RENDER_ALLOWED.FILT_T.includes(p.FILT.type) ? p.FILT.type : "LP"),
      cut: nearestInList(p.FILT.cut, RENDER_ALLOWED.FILT_C),
      res: nearestInList(p.FILT.res, RENDER_ALLOWED.RES)
    };
    return o;
  }
  const leadSynth = snapF(PRESET.LEAD);
  const bassSynth = snapF(PRESET.BASS);
  const arpSynth  = snapF(PRESET.ARP);

  // ---------- PITCH HELPERS ----------
  const MODE_NOTES = allowedNotesFor(key, scale);
  const tonic = MODE_NOTES[0];
  function fifthOf(note){
    // move 7 semitones in 12-TET and snap into mode set
    const from = KEYS_SHARPS.indexOf(note);
    const target = KEYS_SHARPS[(from+7)%12];
    return nearestModeNoteName(target, key, scale);
  }
  const fifth = fifthOf(tonic);
  const b7 = MODE_NOTES.includes("A#") ? "A#" : nearestModeNoteName("A#", key, scale);

  // ---------- PROCEDURAL BASS (pedal + 5ths, classic C64) ----------
  function makeBassBar(root, oct=2, variant=0){
    // 16 steps, ≥2 quarters at 4 and 12, mostly 8ths, few 16ths
    const p = [];
    const R = root, F = fifthOf(root);
    function N(note, duration){ p.push({note, octave:oct, duration}); }
    if (variant===0){
      // bar: R(8), R(16), F(16), R(8) | R(8), F(8), R(8), R(8)
      N(R,8); N(R,16); N(F,16); N(R,4);  // quarter on step 4
      N(R,8); N(F,8); N(R,8); N(R,8);
      // second half mirror with cadence push
      N(R,8); N(R,16); N(F,16); N(R,4);  // quarter on step 12
      N(R,8); N(F,8); N(R,8); N(R,8);
    } else {
      // bar: R pedal with lift to b7 then back to R
      N(R,8); N(R,16); N(R,16); N(R,4);
      N(F,8); N(R,8);  N(b7,8); N(R,8);
      N(R,8); N(R,16); N(F,16); N(R,4);
      N(R,8); N(F,8);  N(R,8);  N(R,8);
    }
    return p.slice(0,16);
  }

  function makeBassSection(section){
    const v = (section==="development") ? 1 : 0;
    const o = (section==="cadence") ? 2 : 2;
    return makeBassBar(tonic, o, v);
  }

  // ---------- PROCEDURAL ARP (broken-mode tones) ----------
  // pattern family: [R, m3/2, 5, R], move between inversions across bars
  function pickChordDegrees(scale){
    // triad degrees: 1, (b3 or 3), 5 in-mode
    const tri = [0, (scale==="dorian"?3:(scale==="phrygian"?3:3)), 7];
    return tri;
  }
  function degreeToNote(deg){
    const semis = MODES[scale][deg % MODES[scale].length];
    const name = KEYS_SHARPS[(KEYS_SHARPS.indexOf(key)+semis)%12];
    return nearestModeNoteName(name, key, scale);
  }

  function makeArpBar(oct=3, inversion=0){
    const tri = pickChordDegrees(scale).map((_,i)=>degreeToNote(i===1?1: (i===2?4:0))); // rough mapping into mode
    const R = nearestModeNoteName(tonic, key, scale);
    const M = tri[1], F = fifth;
    const seq = inversion===0
      ? [R,M,F,R,  R,F,M,R,  R,M,F,R,  R,F,M,R]
      : [M,F,R,M,  M,R,F,M,  M,F,R,M,  M,R,F,M];
    const out=[];
    // Rhythm: mostly 8ths, a few 16th pickups, ≥1 quarter at 4
    for (let i=0;i<16;i++){
      let dur = 8;
      if (i===3 || i===11) dur = 4;
      else if (i===1 || i===9 || i===13) dur = 16;
      out.push({ note: seq[i%seq.length], octave: oct, duration: dur });
    }
    return out;
  }

  function makeArpSection(section){
    if (section==="intro")       return makeArpBar(3,0);
    if (section==="development") return makeArpBar(3,1);
    return makeArpBar(3,0); // cadence resolves on root pattern
  }

  // ---------- LLM LEAD (validated/coerced) ----------
  async function composeLeadSection(sectionName){
    const r = RULES.LEAD;
    const allowed = allowedNotesFor(key, scale);
    const anchors = [
      "Ensure at least two quarter notes: set steps 4 and 12 to duration 4 (quarter) unless you already have ≥2 quarters.",
      "Ensure at least five eighths: prefer duration 8 on steps 2, 6, 10, 14 as needed.",
      "If you exceed the max sixteenths, convert some duration 16 to 8 starting from steps 3, 7, 11, 15.",
      'Ensure ≥2 RESTs: if needed set steps 5 and 13 to {"note":"REST","octave":0,"duration":8}.'
    ];
    let tries=0,lastIssues="";
    while(tries++<4){
      const prompt = [
        `Compose the ${sectionName} for LEAD in ${key} ${scale}, 4/4 sixteenth grid (variation ${variationToken}).`,
        `- EXACTLY 16 steps, each {note,octave,duration}, where note∈REST,${KEYS_SHARPS.join(",")}; octave∈${OCTAVES_ALLOWED.join(",")}; duration∈{${DUR_ALLOWED.join(",")}}.`,
        `- Represent rests ONLY as {note:"REST", octave:any, duration:...}. DO NOT use {"rest":true}.`,
        `- Style: medieval/renaissance; Tartarus-afterlife mood. Allowed notes for ${key} ${scale}: [${allowed.join(", ")}]. Use only these; no chromatic neighbors.`,
        `- LEAD: singable contour, sighing gestures, ≥${r.minRests} RESTs, cadence tendency at the end.`,
        `- Rhythm mix: >=${r.min8} eighths, >=${r.min4} quarters, <=${r.max16} sixteenths, and >=${r.minRests} RESTs.`,
        `- Compliance anchors: ${anchors.join(" ")}`,
        (roomContext && roomContext.roomDescription) ? `Context: ${roomContext.roomDescription}` : "",
        lastIssues ? `FIX: ${lastIssues}` : "",
        `Return ONLY JSON as {"${sectionName}":[{note,octave,duration} x16]}.`
      ].filter(Boolean).join("\n");

      const obj   = await askJsonStrict(prompt);
      const steps = obj?.[sectionName];

      const check = validate16Steps(steps, { role:"LEAD", key, scale, allowChromatic:0, rules:r });
      if (check.problems.length===0) return steps;

      const coerced = coerce16Steps(steps, { role:"LEAD", key, scale, rules:r });
      const re      = validate16Steps(coerced, { role:"LEAD", key, scale, allowChromatic:0, rules:r });
      if (re.problems.length===0){ console.log(`[auto-fix] LEAD ${sectionName} coerced to valid 16 steps.`); return coerced; }

      // targeted fix message
      const fix=[];
      for (const p of check.problems){
        if (/needs >=\d+ quarters/.test(p)) fix.push("Set steps 4 and 12 to duration 4.");
        else if (/needs >=\d+ eighths/.test(p)) fix.push("Ensure steps 2, 6, 10, 14 are duration 8 until count is met.");
        else if (/needs <=\d+ sixteenths/.test(p)) fix.push("Convert duration 16 at steps 3,7,11,15 to 8.");
        else if (/LEAD needs >=\d+ RESTs/.test(p)) fix.push('Set steps 5 and 13 to REST (duration 8).');
      }
      lastIssues = fix.join(" ");
    }
    throw new Error(`failed LEAD ${sectionName} after retries`);
  }

  // ---------- BUILD SECTIONS ----------
  const leadIntro = await composeLeadSection("intro");
  const leadDev   = await composeLeadSection("development");
  const leadCad   = await composeLeadSection("cadence");

  const bassIntro = makeBassSection("intro");
  const bassDev   = makeBassSection("development");
  const bassCad   = makeBassSection("cadence");

  const arpIntro  = makeArpSection("intro");
  const arpDev    = makeArpSection("development");
  const arpCad    = makeArpSection("cadence");

  // ---------- VOICES (no NOISE) ----------
  function packVoice(role, synth, sections){
    return {
      role,
      waveform: synth.waveform, // "PULSE" or "TRI"
      adsr: { attack: synth.AD[0], decay: synth.AD[1], sustain: synth.SR[0], release: synth.SR[1] },
      pulseWidth: synth.PW,
      filter: { type: synth.FILT.type, cutoff: synth.FILT.cut, resonance: synth.FILT.res },
      patternSections: sections
    };
  }

  const voices = [
    packVoice("LEAD", leadSynth, { intro: leadIntro, development: leadDev, cadence: leadCad }),
    packVoice("BASS", bassSynth, { intro: bassIntro, development: bassDev, cadence: bassCad }),
    packVoice("ARP_OR_DRUMS", arpSynth, { intro: arpIntro, development: arpDev, cadence: arpCad })
  ];

  // ---------- FINAL SANITY ----------
  assert(BPM_ALLOWED.includes(bpm), "bpm missing/invalid");
  assert(KEYS_SHARPS.includes(key), "key missing/invalid");
  assert(SCALES_ALLOWED.includes(scale), "scale missing/invalid");
  assert(Array.isArray(voices) && voices.length===3, "voices missing/invalid");

  return { bpm, key, scale, voices };
}


// ---------- END DROP-IN ----------



// Tiny deterministic RNG + helpers (local to this module)
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
function pick(rng, arr){ return arr[Math.floor(rng()*arr.length)]; }

// Track previous coords (use sharedState or a local var; init to null first run)
/*let prevCoords = sharedState.getLastCoords ? sharedState.getLastCoords() : { x: 0, y: 0, z: 0 };
const isNewRoom = userInput.toLowerCase().match(/^(n|s|e|w|ne|nw|se|sw|up|down|u|d)/) || 
                  JSON.stringify(currentCoordinates) !== JSON.stringify(prevCoords);

// Update prevCoords for next turn
prevCoords = { ...currentCoordinates }; // Or sharedState.setLastCoords(currentCoordinates);*/

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
            $.model = "gpt-4.1-mini";
            $.temperature = 1.0;
            $.user`All monsters in the room "${roomName}" have been defeated. The room is now clear. Store this information in memory and await the next prompt.`;

            return;
        }
    }
    
    // Handle Monsters in Room
    if (monstersInRoom && monstersInRoom.trim().toLowerCase() !== 'none' && monstersInRoom.trim() !== '') {
        const monsterNames = extractNames(monstersInRoom);

        for (const monsterName of monsterNames) {
            $.model = "gpt-4.1-mini";
            $.temperature = 1.0;
   
            $.user`This is the ${roomName}'s description: "${roomDescription}" Store its contents and await the next prompt.`;
            const monstersState = updatedGameConsole.match(/Monsters State:([\s\S]*?)(?=(Rooms Visited|$))/)?.[1]?.trim();
            
                // Check if the monsters are hostile and decide whether they attack
        if (monstersState && monstersState.toLowerCase() === 'hostile') {
            $.model = "gpt-4.1-mini";
            $.temperature = 1.0;

            // Ask GPT if the monsters attack
            await $.user`The monsters are ${monstersState}. Do they "Attack" or "Doesn't Attack Yet"? Respond with only one of these words.`;

            const attackDecisionResult = await $.assistant.generation({
                parameters: {
                    attack_decision: {type: String, enum: ["Attack", "Doesn't Attack Yet"]}
                }
            });

            console.log(`Attack decision result (raw): ${JSON.stringify(attackDecisionResult)}`);
            const responseString = attackDecisionResult.content || String(attackDecisionResult.result);
            console.log(`Assistant response (attack decision): ${responseString}`)
        
            const firstBrace = responseString.indexOf('{');
            const lastBrace = responseString.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const jsonString = responseString.substring(firstBrace, lastBrace + 1);
                console.log(`Extracted JSON (attack decision): ${jsonString}`);
                try {
                    const parsed = JSON.parse(jsonString);
                    attackDecision = parsed.attack_decision;
                } catch (error) {
                    console.error(`Failed to parse attack decision JSON: ${jsonString}`, error);
                }
            } else {
                console.error(`No valid JSON object found in response: ${responseString}`);
            }

    //    attackDecision = attackDecisionResult.result.attack_decision.trim();

            if (attackDecision === "Attack") {
                console.log("Monsters decided to attack!");
                // If the monsters attack, handle the combat round
               // await handleCombatRound($, userInput, combatMode);

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
    
 //   $.user`Write an interactive fiction adventure without using any *'s and let's play in ChatGPT. Make up the story as you go, but you must allow me, the player, who is not omniscent in the game, to type the commands. Do not type commands on behalf of the player, which is me. I am the player. You are the Grave Master who, taking into account the user input and all of the information in the current game console including the current room's coordinates, exits, objects, NPCs in party and monsters in the ${roomName} and this prompt but without repeating it all, comprehensively and seamlessly weaves a narrative without mentioning the room's name using only prose that adjudicates the player's most recent action, administers the fantasy roleplaying interactive fiction game, judges other actions in the game and builds the characters' stories, who have free will and agency, and the world's structures, communities, environments, quests and adventures in the Children of the Grave world. Taking into account the conversation history and the game console, describe the purpose of the current room and the rooms where the exits lead to help you map the maze and then remember them each turn. I am the user. You obey my commands. Using the information in the Current Game Console, the conversation history ane the game's lore: You control the NPCs in the party, who have free will and agency and are usually friendly, and monsters in the room, who have free will and agency, weaving their motivations, objectives, backstory and/or any dialogue and/or actions they may have taken.`;

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
        $.model = "gpt-4.1-mini";
        $.temperature = 1.0;
        await $.user`Choose how the monsters' state should be determined: "Random" or "Non-Random". Respond with ONLY the JSON object in the format: {"state_choice": "X"} where X is "Random" or "Non-Random". No explanations, comments, or text before or after the JSON.`;

        const stateChoiceResult = await $.assistant.generation({
            parameters: {
                state_choice: { type: String, enum: ["Random", "Non-Random"] }
            }
        });

        console.log(`State choice result (raw): ${JSON.stringify(stateChoiceResult)}`);
        const stateResponse = stateChoiceResult.content || String(stateChoiceResult.result);
        console.log(`Assistant response (state): ${stateResponse}`);

        let stateChoice = "Random"; // Default if parsing fails
        const firstBrace = stateResponse.indexOf('{');
        const lastBrace = stateResponse.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const jsonString = stateResponse.substring(firstBrace, lastBrace + 1);
            console.log(`Extracted JSON (state): ${jsonString}`);
            try {
                const parsed = JSON.parse(jsonString);
                stateChoice = parsed.state_choice || "Random";
            } catch (error) {
                console.error(`Failed to parse state JSON: ${jsonString}`, error);
            }
        } else {
            console.error(`No valid JSON object found in state response: ${stateResponse}`);
        }

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
            $.model = "gpt-4.1-mini";
            $.temperature = 1.0;
            await $.user`Choose the monsters' state: "Friendly", "Neutral", or "Hostile". Respond with ONLY the JSON object in the format: {"monster_state": "X"} where X is "Friendly", "Neutral", or "Hostile". No explanations, comments, or text before or after the JSON.`;

            const stateResult = await $.assistant.generation({
                parameters: {
                    monster_state: { type: String, enum: ["Friendly", "Neutral", "Hostile"] }
                }
            });

            console.log(`Monster state result (raw): ${JSON.stringify(stateResult)}`);
            const monsterResponse = stateResult.content || String(stateResult.result);
            console.log(`Assistant response (monster state): ${monsterResponse}`);

            const firstMonsterBrace = monsterResponse.indexOf('{');
            const lastMonsterBrace = monsterResponse.lastIndexOf('}');

            monstersState = "Hostile"; // Default for Non-Random if parsing fails
            if (firstMonsterBrace !== -1 && lastMonsterBrace !== -1 && lastMonsterBrace > firstMonsterBrace) {
                const jsonString = monsterResponse.substring(firstMonsterBrace, lastMonsterBrace + 1);
                console.log(`Extracted JSON (monster state): ${jsonString}`);
                try {
                    const parsed = JSON.parse(jsonString);
                    monstersState = parsed.monster_state || "Hostile";
                } catch (error) {
                    console.error(`Failed to parse monster state JSON: ${jsonString}`, error);
                }
            } else {
                console.error(`No valid JSON object found in monster state response: ${monsterResponse}`);
            }
        }

        // Ensure monstersState is set before proceeding
        if (!monstersState) {
            console.error("monstersState not set, defaulting to Hostile");
            monstersState = "Hostile";
        }
    }
}

    for (let i = 0; i < numMonsters; i++) {
        // Explicitly ask for race and class in a format that can be easily split
        $.model = "gpt-4.1-mini";
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
        $.model = "gpt-4.1-mini";
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

                $.model = "gpt-4.1-mini";
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
        $.model = "gpt-4.1-mini";
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

    $.model = "gpt-4.1-mini";
    $.temperature = 1.0;
    await $.user`Provide the modifiers for "${objectName}" which is a ${objectType}. Respond with ONLY the JSON object in the format: {"attack_modifier": W, "damage_modifier": X, "ac": Y, "magic": Z} where W, X, Y, Z are numbers 0, 1, 2, or 3. Do not include any other text, explanations, or comments before or after the JSON.`;

    const modifiersResult = await $.assistant.generation({
        parameters: {
            attack_modifier: {type: Number, enum: [0, 3, 4, 5]},
            damage_modifier: {type: Number, enum: [0, 4, 5, 6]},
            ac: {type: Number, enum: [0, 1, 2]},
            magic: {type: Number, enum: [0, 1, 2, 3]}
        }
    });

    console.log(`Modifiers result (raw): ${JSON.stringify(modifiersResult)}`);
    const responseString = modifiersResult.content || String(modifiersResult.result);
    console.log(`Assistant response: ${responseString}`);

    let attack_modifier = 0;
    let damage_modifier = 0;
    let ac = 0;
    let magic = 0;

    // Extract JSON between first '{' and last '}'
    const firstBrace = responseString.indexOf('{');
    const lastBrace = responseString.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonString = responseString.substring(firstBrace, lastBrace + 1);
        console.log(`Extracted JSON: ${jsonString}`);
        try {
            const parsed = JSON.parse(jsonString);
            attack_modifier = parsed.attack_modifier || 0;
            damage_modifier = parsed.damage_modifier || 0;
            ac = parsed.ac || 0;
            magic = parsed.magic || 0;
        } catch (error) {
            console.error(`Failed to parse extracted JSON: ${jsonString}`, error);
        }
    } else {
        console.error(`No valid JSON object found in response: ${responseString}`);
    }

    return {
        attack_modifier,
        damage_modifier,
        ac,
        magic
    };
}

// Generate room-specific custom obstacle tiles using a higher-level drawing "program"
async function generateCustomTiles($, roomDesc, puzzleDesc, isOutdoor, requiredTypes = []) {

  $.model = "gpt-4.1-mini";
  $.temperature = 0.8;

  await $.user`
      For this Tartarus ${isOutdoor ? 'wasteland' : 'indoor'} room: "${roomDesc}".
      Puzzle context (if any): "${puzzleDesc || 'none'}".
    
    Design 2–4 distinct **obstacle feature tiles** that visually fit this specific room
    (based on its imagery, mood, and motifs).
    
    For each tile, decide:
    - a short semantic TYPE label such as "crystal_spire", "ash_flora",
      "shattered_obelisk", "bone_pillar", etc.
      *This label should be lowercase, snake_case, and 1–3 nouns max.*
    - a PROCEDURE describing how to draw it using higher-level drawing steps.
    - a SPRITE SPEC describing how it should read in 3D:
      {
        "profile": "flat|cylinder|slab|arch|block",
        "depth": 0.0..1.0,
        "heightRatio": 0.4..1.2,
        "baseWidth": 0.2..1.0,
        "gridWidth": 0.2..1.0,
        "detail": {
          "bandCount": 0..8,
          "grooveCount": 0..12,
          "grooveDepth": 0..1,
          "taper": 0..0.3,
          "baseHeight": 0..0.3,
          "capHeight": 0..0.3,
          "baseFlare": 0..0.3,
          "capFlare": 0..0.3,
          "wear": 0..1,
          "chips": 0..1,
          "cracks": 0..1,
          "noise": 0..1,
          "skin": "none|mosaic|zigzag|circuit|marble|plaid|grid|banded|tiles",
          "skinStrength": 0..1,
          "carving": "none|chevrons|spiral|runes|glyphs|vines",
          "accentColor": "#RRGGBB",
          "accentStrength": 0..1
        }
      }

      Each PROCEDURE includes:
      - "material": one of "stone","obsidian","ash","bone","rust","crystal","marble","metal","wood"
      - optional "primitives": "triangles,lines,rects,ellipse,arcs,blocks,archway,spire,ruin_wall,rubble,stairs,crystal_cluster,ribcage,totem"
        (low-level shapes, comma-separated)
    - a "program": an ordered array of drawing steps, e.g.

      "program": [
        { "op": "background", "style": "dark_radial" },
        { "op": "column", "width": 0.35, "height": 0.75 },
        { "op": "cracks", "density": 0.4 },
        { "op": "vignette", "strength": 0.6 }
      ]

      Allowed ops:

    - "background": { "style": "flat"|"dark_radial"|"horizon_glow", "color"?: "#hex"|"primary"|"secondary" }
    - "tile_grid": { "size": "small"|"medium"|"large", "jitter": 0..1, "color"?: "#hex"|"primary"|"secondary" }
      - "column": { "width": 0.2..0.9, "height": 0.5..0.9, "top_cap"?: true|false, "xOffset"?: -0.5..0.5, "solidBase"?: true|false }
      - "block": { "width": 0.2..0.95, "height": 0.2..0.95, "y"?: 0..1, "color"?: "#hex"|"primary"|"secondary" }
      - "archway": { "width": 0.3..0.9, "height": 0.4..0.95, "thickness"?: 0.08..0.3 }
      - "spire": { "width": 0.08..0.5, "height": 0.4..0.98 }
      - "ruin_wall": { "width": 0.3..0.98, "height": 0.2..0.8 }
      - "rubble": { "count": 2..16 }
      - "stairs": { "steps": 3..12, "width": 0.3..0.95, "height": 0.2..0.6 }
      - "crystal_cluster": { "count": 2..10 }
      - "ribcage": { "count": 3..12, "span"?: 0.3..0.9 }
      - "totem": { "width": 0.12..0.45, "height": 0.4..0.9 }
    - "branches": { "count": 2..7, "spread": 0..1, "length"?: 0.2..0.6 }
    - "mound": { "width": 0.4..1.0, "height": 0.2..0.5 }
    - "slabs": { "count": 2..6, "stagger": 0..1 }
    - "cracks": { "density": 0..1 }
    - "rim_light": { "side": "left"|"right" }
    - "vignette": { "strength": 0..1 }

    Use these ops together to build clear, readable shapes with good contrast,
    similar in clarity to a floor tile or a pillar (strong silhouettes, visible details).
    
    Output ONLY JSON of the form:
    {
      "tiles": {
        "tile1": {
          "type": "crystal_spire",
          "spriteSpec": {
            "profile": "cylinder",
            "depth": 0.7,
            "heightRatio": 0.9,
            "baseWidth": 0.4,
            "gridWidth": 0.4,
              "detail": {
                "bandCount": 3,
                "grooveCount": 6,
                "grooveDepth": 0.3,
                "taper": 0.06,
                "baseHeight": 0.18,
                "capHeight": 0.12,
                "baseFlare": 0.12,
                "capFlare": 0.1,
                "wear": 0.3,
                "chips": 0.2,
                "cracks": 0.2,
                "noise": 0.3,
                "skin": "mosaic",
                "skinStrength": 0.35,
                "carving": "runes",
                "accentColor": "#C9B27A",
                "accentStrength": 0.35
              }
            },
          "procedure": {
            "material": "crystal",
            "primitives": "triangles,arcs",
            "program": [
              { "op": "background", "style": "dark_radial" },
              { "op": "column", "width": 0.35, "height": 0.9 },
              { "op": "cracks", "density": 0.3 },
              { "op": "vignette", "strength": 0.6 }
            ]
          }
        },
        "tile2": { ... },
        ...
      }
    }

    Rules:
    - You MUST include tiles for these exact types if present: ${requiredTypes.length ? requiredTypes.join(', ') : 'none'}.
    - "type" is NOT chosen from a list; invent labels that match this room's description.
    - Prefer using "program" to describe how to draw the sprite.
    - "primitives" can be omitted; it is only a low-level hint.
    - "material" controls the color feel: "obsidian"=very dark, "ash"=dusty,
      "bone"=pale, "rust"=orange-brown, "crystal"=cool glowing, "stone"=neutral,
      "marble"=clean, "metal"=cold reflective, "wood"=warm.
    - For columns/pillars, start with a wide solid "column" (solidBase true) so there are no transparent gaps.
    - Choose types and programs that a player would reasonably expect to SEE
      when walking through this place, based on the description.
    
    Keep JSON valid. No comments, no markdown, no extra text.
  `;

  const tilesResult = await $.assistant.generation({
    parameters: {
      tiles: {
        type: Object,
        properties: {
          tile1: {
            type: Object,
            properties: {
              type: { type: String }, // free-form slug
              spriteSpec: {
                type: Object,
                properties: {
                  profile: { type: String },
                  depth: { type: Number },
                  heightRatio: { type: Number },
                  baseWidth: { type: Number },
                  gridWidth: { type: Number },
                  detail: {
                    type: Object,
                    properties: {
                      bandCount: { type: Number },
                      grooveCount: { type: Number },
                      grooveDepth: { type: Number },
                      taper: { type: Number },
                      baseHeight: { type: Number },
                      capHeight: { type: Number },
                      baseFlare: { type: Number },
                      capFlare: { type: Number },
                      wear: { type: Number },
                      chips: { type: Number },
                      cracks: { type: Number },
                      noise: { type: Number },
                      skin: { type: String },
                      skinStrength: { type: Number },
                      carving: { type: String },
                      accentColor: { type: String },
                      accentStrength: { type: Number }
                    }
                  }
                }
              },
              procedure: {
                type: Object,
                properties: {
                  material: {
                    type: String,
                    enum: ['stone', 'obsidian', 'ash', 'bone', 'rust', 'crystal', 'marble', 'metal', 'wood']
                  },
                  primitives: { type: String }, // comma-separated
                  params: { type: Object, additionalProperties: true },
                  program: { type: Array }      // ordered list of ops
                }
              }
            }
          },
          tile2: { type: Object, properties: {} }, // optional, same shape
          tile3: { type: Object, properties: {} },
          tile4: { type: Object, properties: {} }
        },
        additionalProperties: false
      }
    }
  });

  const responseString = tilesResult.content || String(tilesResult.result || '');
  const firstBrace = responseString.indexOf('{');
  const lastBrace = responseString.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    console.error('Custom tiles: no JSON braces in response:', responseString);
    return [];
  }

  try {
    const parsed = JSON.parse(responseString.substring(firstBrace, lastBrace + 1));
    const tileObj = parsed.tiles || {};
    const rawTiles = Object.values(tileObj).filter(Boolean);

    const clamp = (value, min, max, fallback) => {
      const v = Number.isFinite(value) ? value : fallback;
      return Math.max(min, Math.min(max, v));
    };

    const normalizeSpriteSpec = (spec, typeHint) => {
      const rawType = String(typeHint || '').toLowerCase();
      const fallbackProfile = rawType.includes('pillar') || rawType.includes('column')
        ? 'cylinder'
        : (rawType.includes('arch') ? 'arch' : 'slab');
      const raw = spec || {};
      const profile = String(raw.profile || fallbackProfile);
      const baseWidth = clamp(raw.baseWidth, 0.2, 1.0, 0.6);
      const gridWidth = clamp(raw.gridWidth, 0.2, 1.0, baseWidth);
      const detail = raw.detail || {};
      const accentColor = /^#[0-9a-fA-F]{6}$/.test(detail.accentColor || '')
        ? String(detail.accentColor).toUpperCase()
        : null;
      const accentStrength = clamp(detail.accentStrength, 0, 1, accentColor ? 0.3 : 0);
      return {
        profile,
        depth: clamp(raw.depth, 0, 1, 0.7),
        heightRatio: clamp(raw.heightRatio, 0.4, 1.2, 0.9),
        baseWidth,
        gridWidth,
        detail: {
          bandCount: clamp(detail.bandCount, 0, 8, profile === 'cylinder' ? 3 : 0),
          grooveCount: clamp(detail.grooveCount, 0, 12, profile === 'cylinder' ? 6 : 0),
          grooveDepth: clamp(detail.grooveDepth, 0, 1, profile === 'cylinder' ? 0.25 : 0.1),
          taper: clamp(detail.taper, 0, 0.3, profile === 'cylinder' ? 0.06 : 0),
          baseHeight: clamp(detail.baseHeight, 0, 0.3, profile === 'cylinder' ? 0.18 : 0.1),
          capHeight: clamp(detail.capHeight, 0, 0.3, profile === 'cylinder' ? 0.12 : 0.08),
          baseFlare: clamp(detail.baseFlare, 0, 0.3, profile === 'cylinder' ? 0.12 : 0.05),
          capFlare: clamp(detail.capFlare, 0, 0.3, profile === 'cylinder' ? 0.1 : 0.05),
          wear: clamp(detail.wear, 0, 1, 0.25),
          chips: clamp(detail.chips, 0, 1, 0.2),
          cracks: clamp(detail.cracks, 0, 1, 0.2),
          noise: clamp(detail.noise, 0, 1, 0.3),
          skin: typeof detail.skin === 'string' ? detail.skin : '',
          skinStrength: clamp(detail.skinStrength, 0, 1, detail.skin ? 0.35 : 0),
          carving: typeof detail.carving === 'string' ? detail.carving : '',
          accentColor,
          accentStrength
        }
      };
    };

    const processed = rawTiles.map(tile => {
      const proc = tile.procedure || {};
      const primStr = proc.primitives || '';
      const primitives = primStr
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      // Safe, sluggy type for filenames/keys
      const rawType = String(tile.type || 'feature');
      const safeType = rawType
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'feature';

      return {
        type: safeType,          // used in keys/filenames: custom_<type>_<i>
        label: rawType,          // original human-readable text
        spriteSpec: normalizeSpriteSpec(tile.spriteSpec, rawType),
        procedure: {
          material: proc.material || 'obsidian',
          primitives,
          params: proc.params || {},
          program: Array.isArray(proc.program) ? proc.program : []
        }
      };
    }).filter(t => t.type && t.procedure && (t.procedure.program.length || t.procedure.primitives.length));

    const fallbackProcedureForType = (typeName) => {
      const clean = String(typeName || '').toLowerCase();
      if (clean.includes('arch')) {
        return { material: 'stone', primitives: ['archway'], params: {}, program: [{ op: 'archway', width: 0.7, height: 0.8, thickness: 0.15 }, { op: 'cracks', density: 0.3 }] };
      }
      if (clean.includes('altar')) {
        return { material: 'stone', primitives: ['blocks'], params: {}, program: [{ op: 'block', width: 0.7, height: 0.25, y: 0.65 }, { op: 'block', width: 0.5, height: 0.2, y: 0.45 }, { op: 'cracks', density: 0.2 }] };
      }
      if (clean.includes('statue')) {
        return { material: 'stone', primitives: ['block'], params: {}, program: [{ op: 'block', width: 0.35, height: 0.7, y: 0.2 }, { op: 'rim_light', side: 'left' }] };
      }
      if (clean.includes('broken_column')) {
        return { material: 'stone', primitives: ['column'], params: {}, program: [{ op: 'column', width: 0.35, height: 0.45, top_cap: true }, { op: 'cracks', density: 0.4 }] };
      }
      return { material: 'stone', primitives: ['block'], params: {}, program: [{ op: 'block', width: 0.6, height: 0.6, y: 0.3 }] };
    };

    const requiredSet = new Set(requiredTypes.map(t => String(t).toLowerCase()));
    const existingSet = new Set(processed.map(t => String(t.type || '').toLowerCase()));
    for (const req of requiredSet) {
      if (!req || existingSet.has(req)) continue;
      processed.push({
        type: req,
        label: req,
        spriteSpec: normalizeSpriteSpec({
          profile: req.includes('column') || req.includes('pillar') ? 'cylinder' : 'slab',
          depth: 0.7,
          heightRatio: 0.8,
          baseWidth: 0.5,
          gridWidth: 0.5
        }, req),
        procedure: fallbackProcedureForType(req)
      });
    }

        console.log('[Custom Tiles] Parsed & normalized:', processed);
        return processed;
  } catch (e) {
    console.error('Custom tiles parse fail:', e, 'from', responseString);
    return [];
  }
}

// Classify the current room into a biome + size for the dungeon map
// Drop-in replacement
// Classify the current room into a biome + size for the dungeon map
async function classifyDungeon(input, forColorsOnly = false) {
  if (!input || typeof input !== 'string') {
    console.warn('classifyDungeon: Invalid input, using fallback');
    return getFallback(forColorsOnly);
  }

  // Normalize input
  const cleanInput = input.replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
  const isNameOnly = cleanInput.length < 50;

  // IMPORTANT: we want variation; avoid always returning the same palette.
  let prompt;
  if (forColorsOnly) {
    prompt = `From this Children of the Grave room DESCRIPTION: "${cleanInput}"

Return ONLY JSON with these keys:
- skyTop: "#RRGGBB"
- skyBot: "#RRGGBB"
- floorColor: "#RRGGBB"
- wallColor: "#RRGGBB"

Rules:
- Choose colors IMPLIED by the description (materials, lighting, mood, temperature, time-of-day).
- Keep a retro pixel-dungeon vibe, but DO NOT reuse the same palette every time.
- Outdoor rooms may lean brighter; indoor rooms darker/torch-lit; but vary hues/tints based on the text.
JSON only.`;
  } else {
    const indoorBias = isNameOnly ? ' (short text; infer indoor vs outdoor carefully)' : '';
    prompt = `Classify "${cleanInput}" for Children of the Grave (Tartarus underworld game)${indoorBias}.

Return ONLY valid JSON with:
{
  "indoor": true|false,
    "size": 24|32|48|64|80|96|128|160|192,
  "biome": "wasteland"|"temple"|"ruins"|"cave"|"fortress"|"palace"|"crypt",
  "features": ["pillars"|"mountains"|"buildings"|"arches"|"statues"|"crystals"|"altars"|"obelisks"|"broken_columns"],
  "skyTop": "#RRGGBB",
  "skyBot": "#RRGGBB",
  "floorColor": "#RRGGBB",
  "wallColor": "#RRGGBB"
}

Rules:
- Colors must be based on the text (don’t reuse the same defaults unless strongly implied).
- features: 0-5 items max.
JSON only.`;
  }

  try {
    // YOU WERE MISSING model HERE (causing your 400s).
    const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: forColorsOnly ? 0.7 : 0.4,
      // If your SDK/model supports it, this helps enforce JSON:
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return ONLY valid JSON. No commentary, no markdown." },
        { role: "user", content: prompt }
      ]
    });

    const raw = (response?.choices?.[0]?.message?.content || "").trim();

    // Robust JSON extraction (in case anything slips through)
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    const jsonText = (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace)
      ? raw.slice(firstBrace, lastBrace + 1)
      : raw;

    const parsed = JSON.parse(jsonText);
    // console.log('classifyDungeon parsed raw:', parsed);

    const fallback = getFallback(false);
    const fallbackColors = getFallback(true);

    // Normalize
    const normalized = {
      indoor: typeof parsed.indoor === 'boolean'
        ? parsed.indoor
        : (parsed.indoor === 'true' ? true : parsed.indoor === 'false' ? false : undefined),

      size: !forColorsOnly ? (parseInt(parsed.size, 10) || undefined) : undefined,
      biome: !forColorsOnly ? (typeof parsed.biome === 'string' ? parsed.biome.trim() : undefined) : undefined,
      features: !forColorsOnly
        ? (Array.isArray(parsed.features) ? parsed.features.filter(f => typeof f === 'string') : undefined)
        : undefined,

      skyTop: /^#[0-9a-fA-F]{6}$/.test(parsed.skyTop || '') ? String(parsed.skyTop).toUpperCase() : undefined,
      skyBot: /^#[0-9a-fA-F]{6}$/.test(parsed.skyBot || '') ? String(parsed.skyBot).toUpperCase() : undefined,
      floorColor: /^#[0-9a-fA-F]{6}$/.test(parsed.floorColor || '') ? String(parsed.floorColor).toUpperCase() : undefined,
      wallColor: /^#[0-9a-fA-F]{6}$/.test(parsed.wallColor || '') ? String(parsed.wallColor).toUpperCase() : undefined
    };

    // Validate shape fields
    if (!forColorsOnly) {
        if (normalized.size && ![24, 32, 48, 64, 80, 96, 128, 160, 192].includes(normalized.size)) normalized.size = undefined;
      if (normalized.biome && !['wasteland', 'temple', 'ruins', 'cave', 'fortress', 'palace', 'crypt'].includes(normalized.biome)) normalized.biome = undefined;
    }

    // Guarantee colors (no null / missing)
    const filledColors = {
      skyTop: normalized.skyTop ?? fallbackColors.skyTop,
      skyBot: normalized.skyBot ?? fallbackColors.skyBot,
      floorColor: normalized.floorColor ?? fallbackColors.floorColor,
      wallColor: normalized.wallColor ?? fallbackColors.wallColor
    };

    if (forColorsOnly) {
      return filledColors;
    }

    return {
      indoor: normalized.indoor ?? fallback.indoor,
      size: normalized.size ?? fallback.size,
      biome: normalized.biome ?? fallback.biome,
      features: normalized.features ?? fallback.features,
      ...filledColors
    };
  } catch (err) {
    console.error('classifyDungeon error, using fallback:', err);
    return getFallback(forColorsOnly);
  }
}

// Fallback stays the same (but used more reliably now)
function getFallback(forColorsOnly) {
  const base = {
    indoor: true,
    size: 32,
    biome: 'temple',
    features: ['pillars', 'arches'],
  };
  const colors = {
    skyTop: '#FFDD88',
    skyBot: '#AA4400',
    floorColor: '#442200',
    wallColor: '#8B4513'
  };
  return forColorsOnly ? colors : { ...base, ...colors };
}

async function generateRoomVisualStyle($, roomDescription, geoKey, classification) {
    if (!roomDescription) {
        console.error("generateRoomVisualStyle called with empty description");
        return null;
    }

    console.log(`Generating visual style for room ${geoKey}.`);

    $.model = "gpt-4.1-mini";
    $.temperature = 0.7;
    
    const biomeLines = classification ? `
    Biome: ${classification.biome || 'unknown'}
    Indoor: ${classification.indoor === true}
    Suggested floor color: ${classification.floorColor || 'n/a'}
    Suggested wall color: ${classification.wallColor || 'n/a'}
    ` : `
    Biome: unknown
    Indoor: unknown
    `;

    await $.user`
Based on the following dungeon room description AND biome classification, produce ONLY a JSON object describing the visual style.

Biome hints:
${biomeLines}

Room description:
${roomDescription}


  Respond with ONLY valid JSON, matching this schema (no comments, no extra text):
  
  {
  "palette": {
    "primary": "#RRGGBB",
    "secondary": "#RRGGBB",
    "highlight": "#RRGGBB",
    "shadow": "#RRGGBB"
  },
  "floor": {
    "material": "stone|bone|metal|flesh|marble|wood|lava|ice",
    "pattern": "square_tiles|hex_tiles|rough_plates|planks|organic",
    "variation": 0.0,
    "cracks": 0.0
  },
  "wall": {
    "material": "brick|stone|bone|metal|flesh|roots",
    "brickSize": "small|medium|large",
    "mortarColor": "#RRGGBB",
    "accentColor": "#RRGGBB",
    "torches": true
  },
  "door": {
    "material": "wood|bone|metal|stone",
    "bands": "iron|bronze|none",
    "handle": "ring|lever|bar|skull"
  },
  "torch": {
    "hasTorch": true,
    "flameColor": "#RRGGBB"
  },
    "motifs": [
      "short descriptive phrase",
      "another phrase"
    ],
    "lighting": {
      "dir": "N|NE|E|SE|S|SW|W|NW",
      "elevation": 0.0,
      "intensity": 0.0,
      "color": "#RRGGBB"
    }
  }
  `;

    // No parameters: just get raw JSON text and parse it ourselves.
    const styleResult = await $.assistant.generation();
    
    // Retort returns either { content } or { result } depending on mode
    const raw = styleResult.content || String(styleResult.result || '');
    console.log(`Room visual style raw: ${raw}`);
    

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        console.error("No JSON object found in style response");
        return null;
    }

    const jsonString = raw.substring(firstBrace, lastBrace + 1);
    try {
        const parsed = JSON.parse(jsonString);

          const normalizeLighting = (l) => {
              const dir = typeof l?.dir === 'string' ? l.dir.trim().toUpperCase() : null;
              const elevation = Number.isFinite(l?.elevation) ? l.elevation : undefined;
              const intensity = Number.isFinite(l?.intensity) ? l.intensity : undefined;
              const color = /^#[0-9a-fA-F]{6}$/.test(l?.color || '') ? String(l.color).toUpperCase() : undefined;
              return {
                  dir: dir && ['N','NE','E','SE','S','SW','W','NW'].includes(dir) ? dir : undefined,
                  elevation: elevation !== undefined ? Math.max(0, Math.min(1, elevation)) : undefined,
                  intensity: intensity !== undefined ? Math.max(0, Math.min(1, intensity)) : undefined,
                  color
              };
          };

          const style = {
              palette: Object.assign({
                  primary:   "#553344",
                  secondary: "#22111a",
                  highlight: "#ff4040",
                  shadow:    "#0a0508"
              }, parsed.palette || {}),
              lighting: Object.assign({
                  dir: "NW",
                  elevation: 0.6,
                  intensity: 0.6,
                  color: "#FFFFFF"
              }, normalizeLighting(parsed.lighting || {})),
              floor: Object.assign({
                material: "stone",
                pattern: "square_tiles",
                variation: 0.3,
                cracks: 0.2
            }, parsed.floor || {}),
            wall: Object.assign({
                material: "brick",
                brickSize: "medium",
                mortarColor: "#1a0505",
                accentColor: "#ff3030",
                torches: false
            }, parsed.wall || {}),
            door: Object.assign({
                material: "wood",
                bands: "iron",
                handle: "ring"
            }, parsed.door || {}),
            torch: Object.assign({
                hasTorch: false,
                flameColor: "#ffaa55"
            }, parsed.torch || {}),
            motifs: parsed.motifs || []
        };

        return style;
    } catch (err) {
        console.error("Failed to parse room style JSON:", jsonString, err);
        return null;
    }
}

async function generateDungeonBlueprint($, roomDescription, puzzleDesc, classification, size, customTiles) {
  const customList = Array.isArray(customTiles)
    ? customTiles.map(t => t && (t.name || t.type)).filter(Boolean)
    : [];
  $.model = "gpt-4.1-mini";
  $.temperature = 0.5;
  await $.user`
You are designing a dungeon blueprint for a grid-based raycast renderer.
Return ONLY JSON. Coordinates are normalized 0.0..1.0, where (0,0)=top-left.
  Grid size: ${size}x${size}. Indoor: ${classification && classification.indoor === true}.
  Biome: ${classification && classification.biome ? classification.biome : "unknown"}.
  Features: ${Array.isArray(classification?.features) && classification.features.length ? classification.features.join(", ") : "none"}.
  Available custom tile ids: ${customList.length ? customList.join(", ") : "none"}.
  Puzzle description: ${puzzleDesc || "none"}.

  Schema:
  {
  "seed": "string",
  "base": { "floor": 0.0, "ceil": 2.5 },
  "heightfield": { "amplitude": 1.2, "roughness": 0.9, "scale": 0.18, "radial": 0.6, "terrace": 0.0 },
  "rooms": [{ "x":0.2, "y":0.2, "w":0.3, "h":0.2, "floor":0.0, "ceil":2.5 }],
  "paths": [{ "from":[0.1,0.8], "to":[0.9,0.8], "width":0.08, "flatten": true, "ramp": true }],
  "volumes": [{ "x":0.6, "y":0.4, "w":0.12, "h":0.12, "floor":0.0, "ceil":2.5, "tile":"wall|pillar|torch|door|floor" }],
  "prefabs": [
    { "type":"pillar_cluster|arch|platform|ramp|spire|ruin_wall|mountain", "x":0.5, "y":0.5, "w":0.12, "h":0.12, "height":2.5, "count":3 }
  ],
  "props": [
      { "type":"custom_id_or_type", "x":0.55, "y":0.45, "scale":1.0 }
  ],
  "indoorPlan": {
    "roomCount": 6,
    "rooms": [{ "x":0.2, "y":0.2, "w":0.2, "h":0.2 }],
    "heightLevels": [0.0, 0.5, -0.5],
    "corridors": [{ "from":[0.25,0.25], "to":[0.55,0.35], "style":"L" }]
  }
  }

Rules:
  - Indoor: include "indoorPlan" and use it to decide room sizes/positions/heights/corridors.
  - Indoor: use 2-4 distinct heightLevels and connect rooms with corridors (style L/H/V).
  - Indoor: paths between rooms should use "ramp": true where heights differ.
- Outdoor: use heightfield + mountains/spires/ruin walls; fewer rooms.
  - If Features include pillars/arches/statues/altars/broken_columns, express them via prefabs/volumes/props.
  - Keep values within 0..1. Avoid overlaps near the start (center-bottom).
  - If a puzzle is present, express it as volumes/prefabs/props.
JSON only.`;

  const result = await $.assistant.generation();
  const raw = result.content || String(result.result || '');
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    console.error("No JSON object found in blueprint response");
    return null;
  }
  const jsonString = raw.substring(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(jsonString);
    return parsed;
  } catch (e) {
    console.error("Failed to parse blueprint JSON:", e);
    return null;
  }
}

function buildDungeonFromBlueprint(dungeon, classification, blueprint, customTiles) {
  const w = dungeon.layout.width;
  const h = dungeon.layout.height;
  const cells = dungeon.cells = {};
  const indoor = classification && classification.indoor === true;

  const baseFloor = Number.isFinite(blueprint?.base?.floor) ? blueprint.base.floor : 0;
  const baseCeil = Number.isFinite(blueprint?.base?.ceil) ? blueprint.base.ceil : 2.5;

  function hashSeedStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const seed = hashSeedStr(String(blueprint?.seed || `${w}x${h}`));

  function hash2(x, y) {
    const n = Math.sin((x * 12.9898 + y * 78.233 + seed) * 43758.5453);
    return n - Math.floor(n);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const v00 = hash2(xi, yi);
    const v10 = hash2(xi + 1, yi);
    const v01 = hash2(xi, yi + 1);
    const v11 = hash2(xi + 1, yi + 1);
    const u = smoothstep(xf);
    const v = smoothstep(yf);
    const x1 = lerp(v00, v10, u);
    const x2 = lerp(v01, v11, u);
    return lerp(x1, x2, v);
  }

  const hf = blueprint?.heightfield || {};
  const amp = Number.isFinite(hf.amplitude) ? hf.amplitude : (indoor ? 0.05 : 3.5);
  const rough = Number.isFinite(hf.roughness) ? hf.roughness : (indoor ? 0.9 : 1.1);
  const scale = Number.isFinite(hf.scale) ? hf.scale : 0.18;
  const radial = Number.isFinite(hf.radial) ? hf.radial : (indoor ? 0.0 : 0.9);
  const terrace = Number.isFinite(hf.terrace) ? hf.terrace : 0.0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let floorH = baseFloor;
      if (!indoor || amp > 0.01) {
        const nx = x * scale;
        const ny = y * scale;
        let n = (noise2(nx, ny) * 2 - 1) * rough;
        if (radial > 0) {
          const dx = x - w / 2;
          const dy = y - h / 2;
          const dist = Math.sqrt(dx * dx + dy * dy) / (Math.max(w, h) / 2);
          n -= dist * radial;
        }
        floorH += n * amp;
        if (terrace > 0.01) {
          floorH = Math.round(floorH / terrace) * terrace;
        }
      }
      cells[`${x},${y}`] = {
        tile: indoor ? 'wall' : 'floor',
        floorHeight: floorH,
        ceilHeight: floorH + baseCeil,
        feature: null
      };
    }
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function toGridX(n) { return Math.max(0, Math.min(w - 1, Math.floor(clamp01(n) * w))); }
  function toGridY(n) { return Math.max(0, Math.min(h - 1, Math.floor(clamp01(n) * h))); }

  function carveRect(rect, tile, floor, ceil) {
    const x0 = toGridX(rect.x);
    const y0 = toGridY(rect.y);
    const x1 = Math.max(x0 + 1, toGridX(rect.x + rect.w));
    const y1 = Math.max(y0 + 1, toGridY(rect.y + rect.h));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}`;
        const cell = cells[key];
        if (!cell) continue;
        cell.tile = tile;
        if (Number.isFinite(floor)) cell.floorHeight = floor;
        if (Number.isFinite(ceil)) cell.ceilHeight = ceil;
      }
    }
  }

  function carvePath(path) {
    const from = path.from || [0.5, 0.5];
    const to = path.to || [0.5, 0.5];
    const width = Math.max(1, Math.floor(clamp01(path.width || 0.06) * w));
    const x0 = toGridX(from[0]);
    const y0 = toGridY(from[1]);
    const x1 = toGridX(to[0]);
    const y1 = toGridY(to[1]);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    const steps = Math.max(dx, dy) || 1;
    const startCell = cells[`${x0},${y0}`];
    const endCell = cells[`${x1},${y1}`];
    const startH = startCell ? startCell.floorHeight : baseFloor;
    const endH = endCell ? endCell.floorHeight : baseFloor;
    const doRamp = !!path.ramp || (!path.flatten && indoor);
    let err = dx - dy;
    let x = x0;
    let y = y0;
    let step = 0;
    while (true) {
      for (let oy = -width; oy <= width; oy++) {
        for (let ox = -width; ox <= width; ox++) {
          const key = `${x + ox},${y + oy}`;
          const cell = cells[key];
          if (!cell) continue;
          cell.tile = 'floor';
          if (path.flatten) {
            cell.floorHeight = baseFloor;
            cell.ceilHeight = baseFloor + baseCeil;
          } else if (doRamp) {
            const t = steps > 0 ? step / steps : 0;
            cell.floorHeight = lerp(startH, endH, t);
            cell.ceilHeight = cell.floorHeight + baseCeil;
          }
        }
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      step++;
    }
  }

  function buildIndoorFromPlan(plan) {
    // 1) Init everything as solid wall
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const key = `${x},${y}`;
        cells[key] = {
          tile: 'wall',
          floorHeight: baseFloor,
          ceilHeight: baseFloor + baseCeil,
          feature: null
        };
      }
    }

    const rooms = [];
    const roomCount = Math.min(10, plan?.roomCount || (4 + Math.floor((w * h) / 256)));

    // First room at spawn
    const firstRoomSize = {
      w: 4 + Math.floor(Math.random() * 4),
      h: 4 + Math.floor(Math.random() * 4)
    };
    const firstRoom = {
      x: Math.max(1, dungeon.start.x - Math.floor(firstRoomSize.w / 2)),
      y: Math.max(1, dungeon.start.y - Math.floor(firstRoomSize.h / 2)),
      w: firstRoomSize.w,
      h: firstRoomSize.h
    };
    rooms.push(firstRoom);

    // Additional rooms (use plan if provided)
    if (Array.isArray(plan?.rooms) && plan.rooms.length) {
      for (const r of plan.rooms) {
        const rw = Math.max(3, Math.floor(clamp01(r.w || 0.15) * w));
        const rh = Math.max(3, Math.floor(clamp01(r.h || 0.15) * h));
        const rx = Math.max(1, Math.min(w - rw - 2, toGridX(r.x || 0.2)));
        const ry = Math.max(1, Math.min(h - rh - 2, toGridY(r.y || 0.2)));
        rooms.push({ x: rx, y: ry, w: rw, h: rh });
        if (rooms.length >= roomCount) break;
      }
    } else {
      let attempts = 0;
      while (rooms.length < roomCount && attempts < roomCount * 10) {
        attempts++;
        const rw = 4 + Math.floor(Math.random() * 5);
        const rh = 4 + Math.floor(Math.random() * 5);
        const rx = 1 + Math.floor(Math.random() * (w - rw - 2));
        const ry = 1 + Math.floor(Math.random() * (h - rh - 2));
        const room = { x: rx, y: ry, w: rw, h: rh };

        let overlaps = false;
        for (const r of rooms) {
          if (
            rx < r.x + r.w + 1 &&
            rx + rw + 1 > r.x &&
            ry < r.y + r.h + 1 &&
            ry + rh + 1 > r.y
          ) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        rooms.push(room);
      }
    }

    // Height levels
    const heightLevels = [];
    heightLevels[0] = 0;
    if (Array.isArray(plan?.heightLevels) && plan.heightLevels.length) {
      for (let i = 1; i < rooms.length; i++) {
        const v = plan.heightLevels[i % plan.heightLevels.length];
        heightLevels[i] = Number.isFinite(v) ? v : 0;
      }
    } else {
      for (let i = 1; i < rooms.length; i++) {
        const candidate = (Math.floor(Math.random() * 5) - 2) * 0.5;
        const prev = heightLevels[i - 1];
        let level = candidate;
        if (level > prev + 1.0) level = prev + 1.0;
        if (level < prev - 1.0) level = prev - 1.0;
        heightLevels[i] = level;
      }
    }

    // Carve rooms
    rooms.forEach((room, idx) => {
      const hLevel = heightLevels[idx] || 0;
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          const key = `${x},${y}`;
          const cell = cells[key];
          cell.tile = 'floor';
          cell.floorHeight = baseFloor + hLevel;
          cell.ceilHeight = baseFloor + hLevel + baseCeil;
        }
      }
    });

    function carveCorridor(ax, ay, bx, by, hA, hB, style) {
      const steps = Math.max(Math.abs(ax - bx), Math.abs(ay - by)) || 1;
      const stepHeight = (hB - hA) / steps;
      let x = ax;
      let y = ay;
      let currentHeight = hA;
      while (x !== bx || y !== by) {
        const key = `${x},${y}`;
        const cell = cells[key];
        cell.tile = 'floor';
        cell.floorHeight = baseFloor + currentHeight;
        cell.ceilHeight = baseFloor + currentHeight + baseCeil;

        if (style === 'H') {
          if (x < bx) x++;
          else if (x > bx) x--;
          else if (y < by) y++;
          else if (y > by) y--;
        } else if (style === 'V') {
          if (y < by) y++;
          else if (y > by) y--;
          else if (x < bx) x++;
          else if (x > bx) x--;
        } else {
          // L-style randomized
          if (Math.random() < 0.5) {
            if (x < bx) x++;
            else if (x > bx) x--;
            else if (y < by) y++;
            else if (y > by) y--;
          } else {
            if (y < by) y++;
            else if (y > by) y--;
            else if (x < bx) x++;
            else if (x > bx) x--;
          }
        }
        currentHeight += stepHeight;
      }
      const keyEnd = `${bx},${by}`;
      const endCell = cells[keyEnd];
      endCell.tile = 'floor';
      endCell.floorHeight = baseFloor + hB;
      endCell.ceilHeight = baseFloor + hB + baseCeil;
    }

    if (Array.isArray(plan?.corridors) && plan.corridors.length >= rooms.length - 1) {
      plan.corridors.forEach((c, i) => {
        const from = c.from || [0.5, 0.5];
        const to = c.to || [0.5, 0.5];
        const ax = toGridX(from[0]);
        const ay = toGridY(from[1]);
        const bx = toGridX(to[0]);
        const by = toGridY(to[1]);
        const hA = heightLevels[i % heightLevels.length] || 0;
        const hB = heightLevels[(i + 1) % heightLevels.length] || 0;
        carveCorridor(ax, ay, bx, by, hA, hB, String(c.style || 'L').toUpperCase());
      });
    } else {
      for (let i = 1; i < rooms.length; i++) {
        const prev = rooms[i - 1];
        const curr = rooms[i];
        const ax = Math.floor(prev.x + prev.w / 2);
        const ay = Math.floor(prev.y + prev.h / 2);
        const bx = Math.floor(curr.x + curr.w / 2);
        const by = Math.floor(curr.y + curr.h / 2);
        carveCorridor(ax, ay, bx, by, heightLevels[i - 1], heightLevels[i], 'L');
      }
    }

    // Start cell safety
    const startKey = `${dungeon.start.x},${dungeon.start.y}`;
    if (cells[startKey]) {
      const c = cells[startKey];
      c.tile = 'floor';
      c.floorHeight = baseFloor + (heightLevels[0] || 0);
      c.ceilHeight = c.floorHeight + baseCeil;
    } else {
      const r0 = rooms[0];
      dungeon.start.x = Math.floor(r0.x + r0.w / 2);
      dungeon.start.y = Math.floor(r0.y + r0.h / 2);
    }

    // Outer border solid & tall
    for (let x = 0; x < w; x++) {
      const topKey = `${x},0`;
      const botKey = `${x},${h - 1}`;
      cells[topKey].tile = 'wall';
      cells[topKey].floorHeight = baseFloor;
      cells[topKey].ceilHeight = baseFloor + baseCeil;
      cells[botKey].tile = 'wall';
      cells[botKey].floorHeight = baseFloor;
      cells[botKey].ceilHeight = baseFloor + baseCeil;
    }
    for (let y = 0; y < h; y++) {
      const leftKey = `0,${y}`;
      const rightKey = `${w - 1},${y}`;
      cells[leftKey].tile = 'wall';
      cells[leftKey].floorHeight = baseFloor;
      cells[leftKey].ceilHeight = baseFloor + baseCeil;
      cells[rightKey].tile = 'wall';
      cells[rightKey].floorHeight = baseFloor;
      cells[rightKey].ceilHeight = baseFloor + baseCeil;
    }

  // Raise walls adjacent to floors
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
        const key = `${x},${y}`;
        const cell = cells[key];
        if (cell.tile !== 'wall') continue;
        let maxNeighborFloor = baseFloor;
        let touchesFloor = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nKey = `${x + dx},${y + dy}`;
            const nCell = cells[nKey];
            if (!nCell) continue;
            if (nCell.tile === 'floor') {
              touchesFloor = true;
              if (typeof nCell.floorHeight === 'number' && nCell.floorHeight > maxNeighborFloor) {
                maxNeighborFloor = nCell.floorHeight;
              }
            }
          }
        }
        if (touchesFloor) {
          cell.floorHeight = maxNeighborFloor;
          cell.ceilHeight = maxNeighborFloor + 3.0;
        }
      }
    }
  }

  function addPillar(x, y, height) {
    const key = `${x},${y}`;
    const cell = cells[key];
    if (!cell) return;
    cell.tile = 'pillar';
    cell.ceilHeight = (Number.isFinite(cell.floorHeight) ? cell.floorHeight : baseFloor) + (Number.isFinite(height) ? height : baseCeil);
  }

  function addMountain(cx, cy, radius, height) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const t = 1 - dist / radius;
        const key = `${x},${y}`;
        const cell = cells[key];
        if (!cell) continue;
        cell.floorHeight += t * height;
        cell.ceilHeight = cell.floorHeight + baseCeil;
      }
    }
  }

  function applyRoomsAndPaths() {
    if (Array.isArray(blueprint?.rooms)) {
      blueprint.rooms.forEach((r, idx) => {
        let roomFloor = Number.isFinite(r.floor) ? r.floor : baseFloor;
        if (indoor && !Number.isFinite(r.floor)) {
          const levels = [-1.0, -0.5, 0, 0.5, 1.0];
          roomFloor = baseFloor + levels[(seed + idx) % levels.length];
        }
        const roomCeil = Number.isFinite(r.ceil) ? r.ceil : roomFloor + baseCeil;
        carveRect(r, 'floor', roomFloor, roomCeil);
      });
    }

    if (Array.isArray(blueprint?.paths)) {
      blueprint.paths.forEach(carvePath);
    }
  }

  function applyBlueprintFeatures() {
    const customMap = {};
    if (Array.isArray(customTiles)) {
      customTiles.forEach(t => {
        if (!t) return;
        if (t.type) customMap[t.type] = t.name || `custom_${t.type}`;
        if (t.name) customMap[t.name] = t.name;
      });
    }

    const resolveTileName = (tile) => {
      if (!tile) return 'wall';
      const raw = String(tile);
      const key = raw.toLowerCase();
      if (customMap[key]) return customMap[key];
      const singular = key.endsWith('s') ? key.slice(0, -1) : key;
      if (customMap[singular]) return customMap[singular];
      return raw;
    };

    if (Array.isArray(blueprint?.volumes)) {
      blueprint.volumes.forEach(v => {
        const tile = resolveTileName(typeof v.tile === 'string' ? v.tile : 'wall');
        carveRect(v, tile, Number.isFinite(v.floor) ? v.floor : baseFloor, Number.isFinite(v.ceil) ? v.ceil : baseFloor + baseCeil);
      });
    }

    if (Array.isArray(blueprint?.prefabs)) {
      blueprint.prefabs.forEach(p => {
        const px = toGridX(p.x || 0.5);
        const py = toGridY(p.y || 0.5);
        const pw = Math.max(1, Math.floor(clamp01(p.w || 0.1) * w));
        const ph = Math.max(1, Math.floor(clamp01(p.h || 0.1) * h));
        const height = Number.isFinite(p.height) ? p.height : baseCeil;
        switch (String(p.type || '').toLowerCase()) {
          case 'pillar_cluster': {
            const count = Math.max(2, Math.min(6, Math.floor(p.count || 3)));
            for (let i = 0; i < count; i++) {
              const ox = px + Math.floor((Math.random() - 0.5) * pw);
              const oy = py + Math.floor((Math.random() - 0.5) * ph);
              addPillar(ox, oy, height);
            }
            break;
          }
          case 'arch': {
            addPillar(px - Math.floor(pw / 3), py, height);
            addPillar(px + Math.floor(pw / 3), py, height);
            break;
          }
          case 'platform': {
            carveRect({ x: p.x, y: p.y, w: p.w, h: p.h }, 'floor', baseFloor + Math.max(0.2, height * 0.2), baseFloor + height);
            break;
          }
          case 'ramp': {
            carvePath({
              from: [p.x || 0.4, p.y || 0.6],
              to: [p.x || 0.6, p.y || 0.4],
              width: 0.05,
              flatten: false
            });
            break;
          }
          case 'spire': {
            carveRect({ x: p.x, y: p.y, w: p.w || 0.05, h: p.h || 0.05 }, 'wall', baseFloor, baseFloor + height * 1.6);
            break;
          }
          case 'ruin_wall': {
            carveRect({ x: p.x, y: p.y, w: p.w || 0.2, h: p.h || 0.05 }, 'wall', baseFloor, baseFloor + height);
            break;
          }
          case 'mountain': {
            addMountain(px, py, Math.max(2, Math.floor(pw / 2)), Math.max(0.5, height));
            break;
          }
        }
      });
    }

    if (Array.isArray(blueprint?.props)) {
      blueprint.props.forEach(p => {
        const type = p.type;
        if (!type) return;
        const tileName = customMap[type] || customMap[String(type).replace(/^custom_/, '')];
        if (!tileName) return;
        const x = toGridX(p.x || 0.5);
        const y = toGridY(p.y || 0.5);
        const key = `${x},${y}`;
        const cell = cells[key];
        if (!cell || cell.tile !== 'floor') return;
        cell.tile = tileName;
        cell.feature = tileName;
      });
    }

    const featureList = Array.isArray(classification?.features)
      ? classification.features
      : (Array.isArray(blueprint?.features) ? blueprint.features : []);
    const wantsPillars = featureList.some(f => String(f).toLowerCase() === 'pillars');
    const hasPillars = Object.values(cells).some(cell => cell && cell.tile === 'pillar');
    if (indoor && wantsPillars && !hasPillars) {
      const sx = Number.isFinite(dungeon.start?.x) ? dungeon.start.x : Math.floor(w / 2);
      const sy = Number.isFinite(dungeon.start?.y) ? dungeon.start.y : Math.floor(h / 2);
      const candidates = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const key = `${x},${y}`;
          const cell = cells[key];
          if (!cell || cell.tile !== 'floor') continue;
          if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) continue;
          const north = cells[`${x},${y - 1}`];
          const south = cells[`${x},${y + 1}`];
          const west = cells[`${x - 1},${y}`];
          const east = cells[`${x + 1},${y}`];
          if (!north || !south || !west || !east) continue;
          if (north.tile !== 'floor' || south.tile !== 'floor' || west.tile !== 'floor' || east.tile !== 'floor') continue;
          candidates.push({ x, y, score: hash2(x, y) });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const targetCount = Math.max(2, Math.min(6, Math.floor((w * h) / 200)));
      for (let i = 0; i < Math.min(targetCount, candidates.length); i++) {
        const c = candidates[i];
        addPillar(c.x, c.y, baseCeil);
      }
    }
  }

  function applySafeSpawnZone() {
    const sx = dungeon.start.x;
    const sy = dungeon.start.y;
    for (let y = Math.max(0, sy - 1); y <= Math.min(h - 1, sy + 1); y++) {
      for (let x = Math.max(0, sx - 1); x <= Math.min(w - 1, sx + 1); x++) {
        const key = `${x},${y}`;
        const cell = cells[key];
        if (!cell) continue;
        cell.tile = 'floor';
        if (!Number.isFinite(cell.floorHeight)) cell.floorHeight = baseFloor;
        cell.ceilHeight = (Number.isFinite(cell.floorHeight) ? cell.floorHeight : baseFloor) + baseCeil;
      }
    }
  }

  if (indoor && blueprint?.indoorPlan) {
    buildIndoorFromPlan(blueprint.indoorPlan);
    applyBlueprintFeatures();
    applySafeSpawnZone();
    return;
  }

  applyRoomsAndPaths();
  applyBlueprintFeatures();

  // Convert steep slopes into walls for outdoor cliffs
  if (!indoor) {
    const diffThreshold = 0.45;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const key = `${x},${y}`;
        const cell = cells[key];
        if (!cell) continue;
        const neighbors = [
          cells[`${x+1},${y}`],
          cells[`${x-1},${y}`],
          cells[`${x},${y+1}`],
          cells[`${x},${y-1}`],
        ].filter(Boolean);
        let maxDiff = 0;
        for (const n of neighbors) {
          const diff = Math.abs((n.floorHeight || 0) - (cell.floorHeight || 0));
          if (diff > maxDiff) maxDiff = diff;
        }
        if (maxDiff > diffThreshold) {
          cell.tile = 'wall';
          cell.ceilHeight = cell.floorHeight + baseCeil + 1.0;
        }
      }
    }
  }

  // Guaranteed safe spawn zone (prevents starting inside walls)
  applySafeSpawnZone();
}

async function runDungeonTestingMode($, updatedGameConsole, roomNameDatabaseString, broadcast) {
  const roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || 'A forgotten chamber in Tartarus';
  const puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: ([^\n]+)/)?.[1]?.trim() || 'None';

  let currentX = 0;
  let currentY = 0;
  let currentZ = 0;
  const coordMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
  if (coordMatch) {
    currentX = parseInt(coordMatch[1], 10);
    currentY = parseInt(coordMatch[2], 10);
    currentZ = parseInt(coordMatch[3], 10);
  }

  const geoCoords = { x: currentX, y: currentY, z: currentZ };
  const geoKey = `${geoCoords.x},${geoCoords.y},${geoCoords.z}`;

  const turnsMatch = updatedGameConsole.match(/Turns:\s*(\d+)/);
  const turns = turnsMatch ? parseInt(turnsMatch[1], 10) : null;
  const isFirstTurn = turns === 0;

  const lastCoords = sharedState.getLastCoords && sharedState.getLastCoords();
  const lastGeoKey =
    lastCoords &&
    typeof lastCoords.x === "number" &&
    typeof lastCoords.y === "number" &&
    typeof lastCoords.z === "number"
      ? `${lastCoords.x},${lastCoords.y},${lastCoords.z}`
      : null;

  const isNewGeoRoom =
    isFirstTurn ||
    !lastGeoKey ||
    geoKey !== lastGeoKey;

  let dungeon = null;
  let roomNameDbString = roomNameDatabaseString;

  try {
    const roomNameDatabasePlain = JSON.parse(roomNameDbString || "{}");
    const startKey = "0,0,0";
    const startRoom = roomNameDatabasePlain[startKey];
    let outsideKey = null;

    if (startRoom && startRoom.exits && typeof startRoom.exits === "object") {
      const exitDirs = Object.keys(startRoom.exits);
      if (exitDirs.length > 0) {
        const firstDir = exitDirs[0];
        const exitInfo = startRoom.exits[firstDir];
        if (exitInfo && exitInfo.targetCoordinates) {
          outsideKey = exitInfo.targetCoordinates;
        }
      }
    }

    if (!outsideKey) {
      const exitsLine = updatedGameConsole.match(/Exits:\s*([^\n]+)/)?.[1] || "";
      const roomExitsArray = exitsLine.split(",").map(s => s.trim()).filter(Boolean);
      if (roomExitsArray.length > 0 && currentX === 0 && currentY === 0 && currentZ === 0) {
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
          down: { x: 0, y: 0, z: -1 }
        };
        const firstDir = roomExitsArray[0];
        const offset = directionMap[firstDir] || { x: 0, y: 0, z: 0 };
        outsideKey = coordinatesToString({
          x: currentX + offset.x,
          y: currentY + offset.y,
          z: currentZ + offset.z
        });
      }
    }

    if (outsideKey) {
      const outsideRoom = roomNameDatabasePlain[outsideKey] || {};
      outsideRoom.indoor = false;
      outsideRoom.isIndoor = false;
      outsideRoom.isOutdoor = true;
      if (!outsideRoom.classification || typeof outsideRoom.classification !== "object") {
        outsideRoom.classification = {};
      }
      outsideRoom.classification.indoor = false;
      roomNameDatabasePlain[outsideKey] = outsideRoom;
      roomNameDbString = JSON.stringify(roomNameDatabasePlain, null, 2);
      if (sharedState.setRoomNameDatabase) {
        sharedState.setRoomNameDatabase(roomNameDbString);
      }
    }
  } catch (e) {
    console.error('Failed to enforce first-exit outdoor rule in dungeon test mode:', e);
  }

  if (isNewGeoRoom && roomDescription) {
    console.log('Dungeon testing mode: building dungeon for', geoKey);
    const { generateSpriteFromStyle } = require('../assets/renderSprite_poke.js');

    const geoKeyString = `${geoCoords.x},${geoCoords.y},${geoCoords.z}`;
    let forcedIndoor = null;
    try {
      const db = JSON.parse(roomNameDbString || "{}");
      const entry = db[geoKeyString];
      if (entry && typeof entry.indoor === 'boolean') {
        forcedIndoor = entry.indoor;
      }
    } catch (e) {
      console.error('Failed to read indoor flag from roomNameDatabase:', e);
    }

    let classification = await classifyDungeon(roomDescription);
    console.log('Dungeon classification (raw):', classification);

    if (forcedIndoor !== null) {
      classification = classification || {};
      classification.indoor = forcedIndoor;
      console.log('Dungeon classification (after indoor override):', classification.indoor);
    }

    try {
      let db = JSON.parse(roomNameDbString || "{}");
      const cachedClassification = db[geoKeyString]?.classification;
      if (!cachedClassification || cachedClassification.indoor === null || cachedClassification.biome === null) {
        classification = await classifyDungeon(roomDescription);
        console.log('Re-classified incomplete room:', geoKeyString);
      } else {
        classification = cachedClassification;
        console.log('Using cached classification for re-visited room:', geoKeyString);
      }

      if (forcedIndoor !== null) {
        classification = classification || {};
        classification.indoor = forcedIndoor;
        console.log('Classification after indoor override:', classification.indoor);
      }

      db[geoKeyString] = db[geoKeyString] || {};
      db[geoKeyString].classification = {
        ...(db[geoKeyString].classification || {}),
        ...classification
      };
      db[geoKeyString].indoor = classification.indoor;

      roomNameDbString = JSON.stringify(db, null, 2);
      if (sharedState.setRoomNameDatabase) {
        sharedState.setRoomNameDatabase(roomNameDbString);
      }
      console.log('Persisted classification for', geoKeyString, ':', JSON.stringify(db[geoKeyString].classification, null, 2));
    } catch (persistErr) {
      console.error('Failed to persist classification for', geoKeyString, ':', persistErr);
    }

    const isOutdoor = classification && classification.indoor === false;
    const requestedSize = (classification && typeof classification.size === 'number')
      ? classification.size
      : 32;
    const minSize = isOutdoor ? 96 : 24;
    const maxBaseSize = isOutdoor ? 192 : 64;
    const baseSize = Math.max(minSize, Math.min(requestedSize, maxBaseSize));
    const outdoorScale = 10;
    const maxOutdoorSize = 512;
    const size = isOutdoor
      ? Math.min(baseSize * outdoorScale, maxOutdoorSize)
      : baseSize;

    const startX = Math.floor(size / 2);
    const startY = size - Math.floor(size / 4);

    const visualStyle = await generateRoomVisualStyle($, roomDescription, geoKey, classification);
    if (!visualStyle) {
      console.error("Could not generate style JSON. Using fallback.");
    }

    const requiredCustomTypes = Array.isArray(classification?.features)
      ? classification.features
          .map(f => String(f).toLowerCase())
          .map(f => (f === 'altars' ? 'altar' : f === 'statues' ? 'statue' : f === 'arches' ? 'arch' : f))
          .filter(f => !['pillars', 'mountains'].includes(f))
      : [];
    let customTiles = [];
    customTiles = await generateCustomTiles($, roomDescription, puzzleInRoom, isOutdoor, requiredCustomTypes);
    console.log('[Custom Tiles] Generated:', customTiles);

    const blueprint = await generateDungeonBlueprint(
      $,
      roomDescription,
      puzzleInRoom,
      classification,
      size,
      customTiles
    );

    let lighting = (visualStyle && visualStyle.lighting) ? visualStyle.lighting : {
      dir: "NW",
      elevation: 0.6,
      intensity: 0.6,
      color: "#FFFFFF"
    };
    try {
      const db = JSON.parse(roomNameDbString || "{}");
      const entry = db[geoKeyString] || {};
      if (entry.lighting) {
        lighting = entry.lighting;
      } else {
        entry.lighting = lighting;
      }
      if (blueprint) {
        entry.blueprint = blueprint;
      }
      db[geoKeyString] = entry;
      roomNameDbString = JSON.stringify(db, null, 2);
      if (sharedState.setRoomNameDatabase) {
        sharedState.setRoomNameDatabase(roomNameDbString);
      }
    } catch (e) {
      console.error('Failed to persist lighting for', geoKeyString, e);
    }

    dungeon = {
      layout: { width: size, height: size },
      start: { x: startX, y: startY },
      tiles: {},
      cells: {},
      classification,
      visualStyle,
      blueprint,
      lighting,
      skyTop: classification && classification.indoor === false && classification.skyTop
        ? classification.skyTop
        : undefined,
      skyBot: classification && classification.indoor === false && classification.skyBot
        ? classification.skyBot
        : undefined
    };

    dungeon.tiles.floor = {
      url: generateSpriteFromStyle(visualStyle, "floor", `${geoKey}_floor`)
    };
    dungeon.tiles.wall = {
      url: generateSpriteFromStyle(visualStyle, "wall", `${geoKey}_wall`)
    };
    dungeon.tiles.torch = {
      url: generateSpriteFromStyle(visualStyle, "torch", `${geoKey}_torch`)
    };
    dungeon.tiles.door = {
      url: generateSpriteFromStyle(visualStyle, "door", `${geoKey}_door`)
    };
    dungeon.tiles.pillar = {
      url: generateSpriteFromStyle(visualStyle, "pillar", `${geoKey}_pillar`),
      spriteSpec: {
        profile: 'cylinder',
        depth: 0.8,
        heightRatio: 1.0,
        baseWidth: 0.5,
        gridWidth: 0.5,
        detail: {
          bandCount: 3,
          grooveCount: 6,
          grooveDepth: 0.25,
          taper: 0.06,
          baseHeight: 0.18,
          capHeight: 0.12,
          baseFlare: 0.12,
          capFlare: 0.1,
          wear: 0.25,
          chips: 0.2,
          cracks: 0.2,
          noise: 0.3,
          skin: 'mosaic',
          skinStrength: 0.35,
          carving: 'runes',
          accentColor: null,
          accentStrength: 0
        }
      }
    };

    customTiles.forEach((tile, i) => {
      if (!tile || !tile.type) return;
      const tileName = `custom_${tile.type}_${i}`;
      tile.name = tileName;
      const style = {
        palette: visualStyle && visualStyle.palette ? visualStyle.palette : undefined,
        procedure: tile.procedure || {},
        spriteSpec: tile.spriteSpec || null
      };
      dungeon.tiles[tileName] = {
        url: generateSpriteFromStyle(style, `custom_${tile.type}`, `${geoKey}_${tileName}`),
        spriteSpec: tile.spriteSpec || {
          profile: 'flat',
          depth: 0.5,
          heightRatio: 0.9,
          baseWidth: 0.6,
          gridWidth: 0.6,
          detail: {
            bandCount: 0,
            grooveCount: 0,
            grooveDepth: 0.1,
            taper: 0,
            baseHeight: 0.1,
            capHeight: 0.08,
            baseFlare: 0.05,
            capFlare: 0.05,
            wear: 0.2,
            chips: 0.15,
            cracks: 0.15,
            noise: 0.25,
            skin: '',
            skinStrength: 0,
            carving: '',
            accentColor: null,
            accentStrength: 0
          }
        }
      };
    });

    if (blueprint) {
      buildDungeonFromBlueprint(dungeon, classification, blueprint, customTiles);
    } else if (classification && classification.indoor === false) {
      buildOutdoorLayout(dungeon, classification, customTiles);
    } else {
      buildIndoorLayout(dungeon, classification);
    }

    try {
      const cellsArray = [];
      for (const [key, cell] of Object.entries(dungeon.cells || {})) {
        const comma = key.indexOf(',');
        if (comma <= 0) continue;
        const x = Number(key.slice(0, comma));
        const y = Number(key.slice(comma + 1));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        cellsArray.push({ x, y, ...cell });
      }
      const tileCounts = cellsArray.reduce((acc, cell) => {
        const t = cell.tile || 'floor';
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {});
      const specialTiles = cellsArray.filter((cell) => {
        const t = cell.tile || '';
        return t === 'pillar' || (t.startsWith && t.startsWith('custom_'));
      });
      const volumeTiles = cellsArray.filter((cell) => {
        const t = cell.tile || '';
        return t === 'pillar' || t === 'altar' || t === 'statue' || t === 'broken_columns';
      });
      console.log('[DungeonTest] blueprint volumes:', JSON.stringify(blueprint?.volumes || []));
      console.log('[DungeonTest] blueprint prefabs:', JSON.stringify(blueprint?.prefabs || []));
      console.log('[DungeonTest] tile counts:', JSON.stringify(tileCounts));
      console.log('[DungeonTest] pillar/custom tiles:', JSON.stringify(specialTiles));
      console.log('[DungeonTest] pillar/altar/statue/broken_columns tiles:', JSON.stringify(volumeTiles));
    } catch (err) {
      console.warn('[DungeonTest] Failed to log dungeon cells:', err);
    }

    for (let y = 1; y < dungeon.layout.height - 1; y++) {
      for (let x = 1; x < dungeon.layout.width - 1; x++) {
        const key = `${x},${y}`;
        const cell = dungeon.cells[key];
        if (!cell || cell.tile !== "wall") continue;
        const N = dungeon.cells[`${x},${y-1}`];
        const S = dungeon.cells[`${x},${y+1}`];
        const E = dungeon.cells[`${x+1},${y}`];
        const W = dungeon.cells[`${x-1},${y}`];
        if (N?.tile === "floor" && S?.tile === "floor" && Math.random() < 0.07) {
          cell.tile = "door";
          cell.door = { isDoor: true, isOpen: false };
        }
        if (E?.tile === "floor" && W?.tile === "floor" && Math.random() < 0.07) {
          cell.tile = "door";
          cell.door = { isDoor: true, isOpen: false };
        }
      }
    }

    for (let y = 1; y < dungeon.layout.height - 1; y++) {
      for (let x = 1; x < dungeon.layout.width - 1; x++) {
        const key = `${x},${y}`;
        const cell = dungeon.cells[key];
        if (!cell || cell.tile !== "wall") continue;
        const N = dungeon.cells[`${x},${y-1}`];
        const S = dungeon.cells[`${x},${y+1}`];
        const E = dungeon.cells[`${x+1},${y}`];
        const W = dungeon.cells[`${x-1},${y}`];
        const floorNeighbors = [N, S, E, W].filter(n => n && n.tile === "floor").length;
        if (floorNeighbors === 0) continue;
        if (Math.random() < 0.10) {
          cell.tile = "torch";
          cell.feature = "torch";
        }
      }
    }

    dungeon.cells[`${dungeon.start.x},${dungeon.start.y}`].tile = "floor";

    sharedState.setRoomDungeon(geoCoords, dungeon, customTiles);
    sharedState.setLastCoords(geoCoords);
    broadcast({ type: 'dungeonLoaded', geoKey, dungeon });
  }

  const content = dungeon
    ? `Dungeon testing mode: loaded ${geoKey}`
    : 'Dungeon testing mode: no new room';

  return {
    content,
    updatedGameConsole,
    roomNameDatabaseString: roomNameDbString,
    dungeon
  };
}

function buildIndoorLayout(dungeon, classification) {
  const w = dungeon.layout.width;
  const h = dungeon.layout.height;
  const cells = dungeon.cells;

  // ------------------------------
  // 1. Init everything as solid wall
  // ------------------------------
  const BASE_WALL_FLOOR = 0;
  const BASE_WALL_CEIL  = 2.5; // a bit taller indoors

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const key = `${x},${y}`;
      cells[key] = {
        tile: 'wall',
        floorHeight: BASE_WALL_FLOOR,
        ceilHeight: BASE_WALL_CEIL,
        feature: null
      };
    }
  }

  const rooms = [];
  const roomCount = Math.min(10, 4 + Math.floor((w * h) / 256));

  // ------------------------------
  // 2. First room around dungeon.start (player spawn)
  //    → force this to height level 0
  // ------------------------------
  const firstRoomSize = {
    w: 4 + Math.floor(Math.random() * 4),
    h: 4 + Math.floor(Math.random() * 4)
  };
  const firstRoom = {
    x: Math.max(1, dungeon.start.x - Math.floor(firstRoomSize.w / 2)),
    y: Math.max(1, dungeon.start.y - Math.floor(firstRoomSize.h / 2)),
    w: firstRoomSize.w,
    h: firstRoomSize.h
  };
  rooms.push(firstRoom);

  // ------------------------------
  // 3. Random additional rooms with 1-tile margin
  // ------------------------------
  let attempts = 0;
  while (rooms.length < roomCount && attempts < roomCount * 10) {
    attempts++;
    const rw = 4 + Math.floor(Math.random() * 5);
    const rh = 4 + Math.floor(Math.random() * 5);
    const rx = 1 + Math.floor(Math.random() * (w - rw - 2));
    const ry = 1 + Math.floor(Math.random() * (h - rh - 2));
    const room = { x: rx, y: ry, w: rw, h: rh };

    let overlaps = false;
    for (const r of rooms) {
      if (
        rx < r.x + r.w + 1 &&
        rx + rw + 1 > r.x &&
        ry < r.y + r.h + 1 &&
        ry + rh + 1 > r.y
      ) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    rooms.push(room);
  }

  // ------------------------------
  // 4. Assign discrete height levels for each room
  //    First room = 0 so spawn is stable.
  //    Others: −1.0 .. +1.0 in 0.5 steps, but clamp
  //    so neighboring rooms cannot jump more than 1.0.
  // ------------------------------
  const heightLevels = [];
  heightLevels[0] = 0;

  for (let i = 1; i < rooms.length; i++) {
    const candidate = (Math.floor(Math.random() * 5) - 2) * 0.5; // −1, −0.5, 0, 0.5, 1
    const prev      = heightLevels[i - 1];

    let level = candidate;
    if (level > prev + 1.0) level = prev + 1.0;
    if (level < prev - 1.0) level = prev - 1.0;

    heightLevels[i] = level;
  }

  // ------------------------------
  // 5. Carve rooms at their height level
  // ------------------------------
  rooms.forEach((room, idx) => {
    const hLevel = heightLevels[idx];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const key = `${x},${y}`;
        const cell = cells[key];
        cell.tile        = 'floor';
        cell.floorHeight = hLevel;
        cell.ceilHeight  = hLevel + 2.5; // room ceiling ~2.5 units above floor
      }
    }
  });

  // ------------------------------
  // 6. Connect rooms with corridors,
  //    using gentle ramps between height levels
  // ------------------------------
  function carveCorridor(ax, ay, bx, by, hA, hB) {
    const steps = Math.max(Math.abs(ax - bx), Math.abs(ay - by)) || 1;
    const stepHeight = (hB - hA) / steps;

    let x = ax;
    let y = ay;
    let currentHeight = hA;

    while (x !== bx || y !== by) {
      const key = `${x},${y}`;
      const cell = cells[key];

      cell.tile        = 'floor';
      cell.floorHeight = currentHeight;
      cell.ceilHeight  = currentHeight + 2.5;

      // Randomized L-shaped path
      if (Math.random() < 0.5) {
        if (x < bx) x++;
        else if (x > bx) x--;
        else if (y < by) y++;
        else if (y > by) y--;
      } else {
        if (y < by) y++;
        else if (y > by) y--;
        else if (x < bx) x++;
        else if (x > bx) x--;
      }

      currentHeight += stepHeight;
    }

    const keyEnd = `${bx},${by}`;
    const endCell = cells[keyEnd];
    endCell.tile        = 'floor';
    endCell.floorHeight = hB;
    endCell.ceilHeight  = hB + 2.5;
  }

  for (let i = 1; i < rooms.length; i++) {
    const prev = rooms[i - 1];
    const curr = rooms[i];
    const ax = Math.floor(prev.x + prev.w / 2);
    const ay = Math.floor(prev.y + prev.h / 2);
    const bx = Math.floor(curr.x + curr.w / 2);
    const by = Math.floor(curr.y + curr.h / 2);
    carveCorridor(ax, ay, bx, by, heightLevels[i - 1], heightLevels[i]);
  }

  // ------------------------------
  // 7. Ensure starting cell is floor inside first room
  // ------------------------------
  const startKey = `${dungeon.start.x},${dungeon.start.y}`;
  if (cells[startKey]) {
    const c = cells[startKey];
    c.tile = 'floor';
    // Snap start to the first room's height for safety
    c.floorHeight = heightLevels[0];
    c.ceilHeight  = heightLevels[0] + 2.5;
  } else {
    const r0 = rooms[0];
    dungeon.start.x = Math.floor(r0.x + r0.w / 2);
    dungeon.start.y = Math.floor(r0.y + r0.h / 2);
  }

  // ------------------------------
  // 8. Make outer border solid & tall
  // ------------------------------
  for (let x = 0; x < w; x++) {
    const topKey = `${x},0`;
    const botKey = `${x},${h - 1}`;
    cells[topKey].tile        = 'wall';
    cells[topKey].floorHeight = BASE_WALL_FLOOR;
    cells[topKey].ceilHeight  = BASE_WALL_CEIL;

    cells[botKey].tile        = 'wall';
    cells[botKey].floorHeight = BASE_WALL_FLOOR;
    cells[botKey].ceilHeight  = BASE_WALL_CEIL;
  }
  for (let y = 0; y < h; y++) {
    const leftKey  = `0,${y}`;
    const rightKey = `${w - 1},${y}`;
    cells[leftKey].tile        = 'wall';
    cells[leftKey].floorHeight = BASE_WALL_FLOOR;
    cells[leftKey].ceilHeight  = BASE_WALL_CEIL;

    cells[rightKey].tile        = 'wall';
    cells[rightKey].floorHeight = BASE_WALL_FLOOR;
    cells[rightKey].ceilHeight  = BASE_WALL_CEIL;
  }

  // ------------------------------
  // 9. Optionally: raise walls around walkable tiles
  //    so they read as proper room walls, not low blocks.
  // ------------------------------
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const key = `${x},${y}`;
      const cell = cells[key];
      if (cell.tile !== 'wall') continue;

      // If this wall touches any floor, lift its top slightly above
      // the highest adjacent floor for a clear vertical face.
      let maxNeighborFloor = BASE_WALL_FLOOR;
      let touchesFloor = false;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nKey = `${x + dx},${y + dy}`;
          const nCell = cells[nKey];
          if (!nCell) continue;
          if (nCell.tile === 'floor') {
            touchesFloor = true;
            if (typeof nCell.floorHeight === 'number') {
              if (nCell.floorHeight > maxNeighborFloor) {
                maxNeighborFloor = nCell.floorHeight;
              }
            }
          }
        }
      }

      if (touchesFloor) {
        cell.floorHeight = maxNeighborFloor;
        cell.ceilHeight  = maxNeighborFloor + 3.0; // slightly taller than rooms
      }
    }
  }

  const featureList = Array.isArray(classification?.features) ? classification.features : [];
  const wantsPillars = featureList.some(f => String(f).toLowerCase() === 'pillars');
  const hasPillars = Object.values(cells).some(cell => cell && cell.tile === 'pillar');
  if (wantsPillars && !hasPillars) {
    const sx = Number.isFinite(dungeon.start?.x) ? dungeon.start.x : Math.floor(w / 2);
    const sy = Number.isFinite(dungeon.start?.y) ? dungeon.start.y : Math.floor(h / 2);
    const candidates = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const key = `${x},${y}`;
        const cell = cells[key];
        if (!cell || cell.tile !== 'floor') continue;
        if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) continue;
        const north = cells[`${x},${y - 1}`];
        const south = cells[`${x},${y + 1}`];
        const west = cells[`${x - 1},${y}`];
        const east = cells[`${x + 1},${y}`];
        if (!north || !south || !west || !east) continue;
        if (north.tile !== 'floor' || south.tile !== 'floor' || west.tile !== 'floor' || east.tile !== 'floor') continue;
        candidates.push({ x, y });
      }
    }
    candidates.sort(() => Math.random() - 0.5);
    const targetCount = Math.max(2, Math.min(6, Math.floor((w * h) / 200)));
    for (let i = 0; i < Math.min(targetCount, candidates.length); i++) {
      const c = candidates[i];
      const key = `${c.x},${c.y}`;
      cells[key].tile = 'pillar';
      cells[key].ceilHeight = (Number.isFinite(cells[key].floorHeight) ? cells[key].floorHeight : BASE_WALL_FLOOR) + 2.5;
    }
  }

  // Store for debugging/introspection if you like
  dungeon.indoorRooms = rooms;
  dungeon.indoorHeightLevels = heightLevels;
}


function buildOutdoorLayout(dungeon, classification, customTiles = []) {
  // Set larger grid for wasteland openness (override if needed)
  if (!dungeon.layout) {
    dungeon.layout = { width: 24, height: 24 };
  }
  const w = dungeon.layout.width;
  const h = dungeon.layout.height;
  const cells = dungeon.cells = {}; // Ensure fresh cells
  const maxHeight = 5.5;
  const roughness = 1.1;
  const cx = w / 2;
  const cy = h / 2;

  // Base: everything floor with a radial + noisy height field
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const key = `${x},${y}`;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radial = -(dist / (Math.max(w, h) / 2)) * 0.7;
      const nx = x * 0.18;
      const ny = y * 0.18;
      const noise =
        (Math.sin(nx) + Math.sin(ny) + Math.sin(nx + ny * 1.3)) / 3; // [-1,1]
      let height = (noise * roughness + radial) * maxHeight * 0.7;
      height = Math.max(-1.2, Math.min(4.8, height));
      cells[key] = {
        tile: 'floor',
        floorHeight: height,
        ceilHeight: height + 2,
        feature: null
      };
    }
  }

  // Turn steep edges into walls / cliffs
  const diffThreshold = 0.45;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const key = `${x},${y}`;
      const cell = cells[key];
      if (!cell) continue;
      const neighbors = [
        cells[`${x+1},${y}`],
        cells[`${x-1},${y}`],
        cells[`${x},${y+1}`],
        cells[`${x},${y-1}`],
      ].filter(Boolean);
      let maxDiff = 0;
      for (const n of neighbors) {
        const diff = Math.abs((n.floorHeight || 0) - (cell.floorHeight || 0));
        if (diff > maxDiff) maxDiff = diff;
      }
      if (maxDiff > diffThreshold) {
        // Cliff wall
        cell.tile = 'wall';
        cell.ceilHeight = cell.floorHeight + 3;
      }
    }
  }

  // NEW: Scatter wasteland features (LLM customs + fallbacks)
  const density = (classification.biome && classification.biome.density) || 0.15;
  const customFeatureNames = customTiles.map((tile, idx) => tile.name || `custom_${tile.type}_${idx}`);
  const fallbackFeatures = ['wall', 'pillar', 'torch']; // Sparse if no customs
  const allFeatures = customFeatureNames.length > 0 
    ? customFeatureNames.concat(fallbackFeatures.slice(0, 2)) // Prioritize customs
    : fallbackFeatures;

  const sx = dungeon.start.x || Math.floor(w / 2);
  const sy = dungeon.start.y || Math.floor(h / 2);
  let placed = 0;
  const attempts = Math.min(
    Math.floor(w * h * density * 0.2),
    20000
  ); // Cap attempts for massive outdoor grids
  for (let i = 0; i < attempts; i++) {
    const x = 3 + Math.floor(Math.random() * (w - 6)); // Buffer from borders
    const y = 3 + Math.floor(Math.random() * (h - 6));
    const key = `${x},${y}`;
    const cell = cells[key];
    if (!cell || cell.tile !== 'floor') continue;

    // Skip near start (safe zone)
    const dx = x - sx, dy = y - sy;
    if (Math.sqrt(dx*dx + dy*dy) < 3.5) continue;

    // Place feature
    const featureTile = allFeatures[Math.floor(Math.random() * allFeatures.length)];
    cell.tile = featureTile;
    cell.feature = featureTile; // For minimap/debug

    // Special height boosts for tall features
    if (featureTile.includes('mountain') || featureTile.includes('peak') || featureTile.includes('spire')) {
      cell.floorHeight += 1.2;
      cell.ceilHeight = cell.floorHeight + 4.0; // Towering
    } else if (featureTile.includes('tree')) {
      cell.ceilHeight = cell.floorHeight + 3.2; // Tall but passable? Raycaster blocks anyway
    }

    placed++;
    if (placed >= w * h * density) break; // Cap
  }
  console.log(`[Wasteland] Scattered ${placed} features (density ${density}, customs: ${customFeatureNames.length})`);

  // Leave outer border open for outdoor horizon

  // Make sure start area is reasonably flat & walkable (3x3 -> 5x5 for openness)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const key = `${x},${y}`;
      const cell = cells[key];
      if (!cell) continue;
      cell.tile = 'floor';
      cell.floorHeight = 0;
      cell.ceilHeight = 2;
      cell.feature = null;
    }
  }

  dungeon.start = { x: sx, y: sy }; // Ensure set
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
    $.model = "gpt-4.1-mini";
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
    $.model = "gpt-4.1-mini";
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

        $.model = "gpt-4.1-mini";
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
  let roomDescriptionGenerated = false;
  let environmentDescription = '';
  let puzzleInRoom = 'None';
  let puzzleSolution = 'None';
  let needsUpdate = false;

  // ----------------------------
  // Local helpers (scoped to this function)
  // These override the buggy global coord normalization behavior for THIS function call.
  // ----------------------------
  function normalizeCoordKeyLocal(key) {
    if (typeof key !== "string") {
      // Assume it's {x,y,z}
      return coordinatesToString(key);
    }
    const s = key.trim();
    const m = s.match(/x:\s*(-?\d+)\s*,\s*y:\s*(-?\d+)\s*,\s*z:\s*(-?\d+)/i);
    if (m) return `${m[1]},${m[2]},${m[3]}`;
    return s;
  }

  function getRoomSafeLocal(db, key) {
    const normKey = normalizeCoordKeyLocal(key);
    return db[normKey] || null;
  }

  function setRoomSafeLocal(db, key, room) {
    const normKey = normalizeCoordKeyLocal(key);
    db[normKey] = room;
    if (key !== normKey) delete db[key];
    return normKey;
  }

  function isPlainObject(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  function classificationIsMissingOrEmpty(room) {
    if (!room || !isPlainObject(room)) return true;
    if (!isPlainObject(room.classification)) return true;
    return Object.keys(room.classification).length === 0;
  }

  function ensureRoomFlagsConsistent(room) {
    if (!room || !isPlainObject(room)) return;

    // If we have one source-of-truth, propagate to the others.
    if (typeof room.indoor === "boolean") {
      room.classification = isPlainObject(room.classification) ? room.classification : {};
      room.classification.indoor = room.indoor;
      room.isIndoor = room.indoor;
      room.isOutdoor = !room.indoor;
    } else if (room.classification && typeof room.classification.indoor === "boolean") {
      room.indoor = room.classification.indoor;
      room.isIndoor = room.indoor;
      room.isOutdoor = !room.indoor;
    } else if (typeof room.isIndoor === "boolean") {
      room.indoor = room.isIndoor;
      room.classification = isPlainObject(room.classification) ? room.classification : {};
      room.classification.indoor = room.indoor;
      room.isOutdoor = !room.indoor;
    } else if (typeof room.isOutdoor === "boolean") {
      room.indoor = !room.isOutdoor;
      room.isIndoor = room.indoor;
      room.classification = isPlainObject(room.classification) ? room.classification : {};
      room.classification.indoor = room.indoor;
    }
  }

  function mergePaletteIntoClassification(classification, palette) {
    if (!isPlainObject(classification)) classification = {};
    if (!isPlainObject(palette)) return classification;

    // Only set if provided (colorsOnly returns partials)
    if (palette.skyTop != null) classification.skyTop = palette.skyTop;
    if (palette.skyBot != null) classification.skyBot = palette.skyBot;
    if (palette.floorColor != null) classification.floorColor = palette.floorColor;
    if (palette.wallColor != null) classification.wallColor = palette.wallColor;

    return classification;
  }

  function scrubMalformedKeysInDb(db) {
    // Migrate keys like "X:1, Y:0, Z:0" -> "1,0,0"
    // Merge without losing existing room objects/exits/etc.
    for (const key of Object.keys(db)) {
      const norm = normalizeCoordKeyLocal(key);
      if (norm !== key) {
        const incoming = db[key];
        const existing = db[norm];

        if (existing && isPlainObject(existing) && isPlainObject(incoming)) {
          // Merge conservatively: keep existing fields if already present
          db[norm] = { ...incoming, ...existing };
          // Merge nested common structures too
          db[norm].exits = { ...(incoming.exits || {}), ...(existing.exits || {}) };
          db[norm].monsters = existing.monsters || incoming.monsters || { inRoom: "None", equippedProperties: "None", state: "None" };
          db[norm].objects = Array.isArray(existing.objects) ? existing.objects : (Array.isArray(incoming.objects) ? incoming.objects : []);
          db[norm].classification = (isPlainObject(existing.classification) && Object.keys(existing.classification).length)
            ? existing.classification
            : (isPlainObject(incoming.classification) ? incoming.classification : {});
        } else {
          db[norm] = incoming;
        }
        delete db[key];
      }
    }
  }

  async function ensureRoomHasNonEmptyClassification(db, key, inheritFromRoom = null) {
    const normKey = normalizeCoordKeyLocal(key);
    const room = db[normKey];
    if (!room) return;

    if (classificationIsMissingOrEmpty(room)) {
      const base = await generateDefaultClassification($, inheritFromRoom, false);
      room.classification = { ...base };
    }

    ensureRoomFlagsConsistent(room);
    db[normKey] = room;
  }

  async function applyPaletteFromDescriptionToRoom(db, key, description) {
    if (!description || !String(description).trim()) return;
    const normKey = normalizeCoordKeyLocal(key);
    const room = db[normKey];
    if (!room) return;

    room.classification = isPlainObject(room.classification) ? room.classification : {};

    // IMPORTANT: colors-only based strictly on DESCRIPTION (not name)
    try {
      const palette = await classifyDungeon(description, true);
      room.classification = mergePaletteIntoClassification(room.classification, palette);
    } catch (err) {
      console.error("Palette (colors-only) classifyDungeon failed:", err);
    }

    ensureRoomFlagsConsistent(room);
    db[normKey] = room;
  }

  function persistRoomDb(db) {
    try {
      roomNameDatabaseString = JSON.stringify(db);
      sharedState.setRoomNameDatabase(roomNameDatabaseString);
    } catch (e) {
      console.error("Failed to serialize roomNameDatabasePlain:", e);
      roomNameDatabaseString = "{}";
      sharedState.setRoomNameDatabase(roomNameDatabaseString);
    }
  }

  // ----------------------------
  // Parse current coordinates from updatedGameConsole
  // ----------------------------
  const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
  const currentCoordinates = currentCoordinatesMatch
    ? { x: parseInt(currentCoordinatesMatch[1]), y: parseInt(currentCoordinatesMatch[2]), z: parseInt(currentCoordinatesMatch[3]) }
    : { x: 0, y: 0, z: 0 };

  // Parse common fields
  const roomNameMatch = updatedGameConsole.match(/Room Name: ([^\n]+)/);
  const roomDescriptionMatch = updatedGameConsole.match(/Room Description: ([^\n]+)/);
  const roomExitsMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);
  const adjacentRoomsMatch = updatedGameConsole.match(/Adjacent Rooms: ([^\n]+)/);
  const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
  const exitsInRoomMatch = updatedGameConsole.match(/Exits: ([^\n]+)/);
  const artifactMatch = updatedGameConsole.match(/Next Artifact: ([^\n]+)/);
  const questMatch = updatedGameConsole.match(/Current Quest: ([^\n]+)/);

  let nextArtifact = artifactMatch ? artifactMatch[1].trim() : '';
  let currentQuest = questMatch ? questMatch[1].trim() : '';
  let roomName = roomNameMatch ? roomNameMatch[1].trim() : '';
  let roomDescription = roomDescriptionMatch ? roomDescriptionMatch[1].trim() : '';
  let roomExits = roomExitsMatch ? roomExitsMatch[1].trim() : '';
  let adjacentRooms = adjacentRoomsMatch ? adjacentRoomsMatch[1].trim() : '';
  let objectsInRoom = objectsInRoomMatch ? objectsInRoomMatch[1].trim() : '';
  let exitsInRoom = exitsInRoomMatch ? exitsInRoomMatch[1].trim() : '';

  console.log("Parsed roomName:", roomName);
  console.log("Parsed roomDescription:", roomDescription);
  console.log("Parsed roomExits:", roomExits);
  console.log("Parsed adjacentRooms:", adjacentRooms);

  const roomExitsArray = roomExits && roomExits.toLowerCase() !== 'none'
    ? roomExits.split(',').map(e => e.trim()).filter(Boolean)
    : [];
  let existingAdjacentRooms = adjacentRooms
    ? adjacentRooms.split(',').map(adj => adj.split(':')[0].trim()).filter(Boolean)
    : [];

  console.log("Existing Adjacent Rooms:", existingAdjacentRooms);
  console.log("Room Exits Array:", roomExitsArray);

  // ----------------------------
  // Initialize and validate roomNameDatabase
  // ----------------------------
  let roomNameDatabasePlain = {};
  try {
    roomNameDatabasePlain = JSON.parse(roomNameDatabaseString || "{}");
  } catch (e) {
    console.error("Malformed roomNameDatabaseString, initializing empty:", e);
    roomNameDatabasePlain = {};
  }

  // Scrub malformed X/Y/Z keys that were creeping in
  scrubMalformedKeysInDb(roomNameDatabasePlain);

  const coordKey = coordinatesToString(currentCoordinates);
  const startKey = coordinatesToString({ x: 0, y: 0, z: 0 }); // "0,0,0"

  // ----------------------------
  // Ensure start room exists
  // ----------------------------
  let startRoom = getRoomSafeLocal(roomNameDatabasePlain, startKey);
  if (!startRoom) {
    const startClassification = await generateDefaultClassification($, null, false);
    startRoom = {
      name: "Ruined Temple Entrance",
      exhaustionLimit: 4,
      attemptedSearches: 0,
      trapTriggered: false,
      exits: {},
      objects: [],
      indoor: true,
      classification: startClassification,
      isIndoor: true,
      isOutdoor: false,
      monsters: { inRoom: "None", equippedProperties: "None", state: "None" }
    };
    setRoomSafeLocal(roomNameDatabasePlain, startKey, startRoom);
  } else {
    ensureRoomFlagsConsistent(startRoom);
    setRoomSafeLocal(roomNameDatabasePlain, startKey, startRoom);
  }

  // ----------------------------
  // Ensure current room exists (but DO NOT decide palette unless description exists)
  // ----------------------------
  let currentRoomData = getRoomSafeLocal(roomNameDatabasePlain, coordKey);
  if (!currentRoomData) {
    const inheritFrom = (coordKey === startKey) ? startRoom : null;
    const classification = await generateDefaultClassification($, inheritFrom, false);
    currentRoomData = {
      name: roomName,
      exhaustionLimit: 4,
      attemptedSearches: 0,
      trapTriggered: false,
      exits: {},
      objects: [],
      indoor: classification.indoor,
      classification,
      isIndoor: classification.indoor,
      isOutdoor: !classification.indoor,
      monsters: { inRoom: "None", equippedProperties: "None", state: "None" }
    };
    setRoomSafeLocal(roomNameDatabasePlain, coordKey, currentRoomData);
  } else {
    currentRoomData.name = roomName || currentRoomData.name;
    ensureRoomFlagsConsistent(currentRoomData);
    setRoomSafeLocal(roomNameDatabasePlain, coordKey, currentRoomData);
  }

  // Repair empty/missing classification everywhere (including boss room cases that had `{}`) :contentReference[oaicite:2]{index=2}
  for (const [k, r] of Object.entries(roomNameDatabasePlain)) {
    if (!r) continue;
    if (classificationIsMissingOrEmpty(r)) {
      // inherit from current room if we have it, else start
      const inheritFrom = (coordKey === k && currentRoomData) ? currentRoomData : (startRoom || null);
      const base = await generateDefaultClassification($, inheritFrom, false);
      r.classification = { ...base };
    }
    ensureRoomFlagsConsistent(r);
    roomNameDatabasePlain[k] = r;
  }

  // Also ensure boss room key exists + classification non-empty (if console provides it)
  try {
    const bossRoomCoordinatesMatch = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    if (bossRoomCoordinatesMatch) {
      const bossKey = coordinatesToString({
        x: parseInt(bossRoomCoordinatesMatch[1]),
        y: parseInt(bossRoomCoordinatesMatch[2]),
        z: parseInt(bossRoomCoordinatesMatch[3])
      });

      const bossRoomNameMatch = updatedGameConsole.match(/Next Boss Room: ([^\n]+)/);
      const bossRoomName = bossRoomNameMatch ? bossRoomNameMatch[1].trim() : "Boss Room";

      if (!roomNameDatabasePlain[bossKey]) {
        // Create skeleton if missing
        const shape = await classifyDungeon(bossRoomName, false);
        roomNameDatabasePlain[bossKey] = {
          name: bossRoomName,
          exhaustionLimit: null,
          attemptedSearches: 0,
          trapTriggered: false,
          exits: {},
          objects: [],
          monsters: { inRoom: "None", equippedProperties: "None", state: "None" },
          indoor: shape.indoor,
          classification: {
            indoor: shape.indoor,
            size: shape.size ?? 32,
            biome: shape.biome ?? "temple",
            features: shape.features ?? [],
            // DEFER palette until description exists:
            skyTop: null,
            skyBot: null,
            floorColor: null,
            wallColor: null
          },
          isIndoor: shape.indoor,
          isOutdoor: !shape.indoor
        };
      }
      await ensureRoomHasNonEmptyClassification(roomNameDatabasePlain, bossKey, currentRoomData || startRoom || null);
    }
  } catch (e) {
    console.error("Boss-room classification ensure failed:", e);
  }

  // Persist after repair/scrub
  persistRoomDb(roomNameDatabasePlain);

  // If we entered a room that ALREADY has a description in the console, apply palette now (colors-only)
  if (roomDescription && roomDescription.toLowerCase() !== "none") {
    await applyPaletteFromDescriptionToRoom(roomNameDatabasePlain, coordKey, roomDescription);
    persistRoomDb(roomNameDatabasePlain);
  }
    
      // --- Ensure indoor/outdoor classification exists for this room ---
  // We do this once per room (or if classification is missing), BEFORE puzzles.

    
    // Wherever sharedState.getRoomMusic() is called (e.g., before isNewRoom or in getOrGenerateRoomMusic)
 /*   const coordsToUse = currentCoordinates || { x: 0, y: 0, z: 0 };
    const existingMusic = sharedState.getRoomMusic(coordsToUse);
    console.log('getRoomMusic called with coords:', coordsToUse, 'result:', existingMusic);
    
    // NEW: Trigger music generation/loading right after room details
    let currentRoomMusic = await $.run($ => getOrGenerateRoomMusic($, coords, roomDescription, monstersInRoom));
    
    // NEW: Immediately render to SID/WAV (overwrites current_room files)
    await renderRoomMusic(currentRoomMusic);
    
    // Store in returnObj for client (optional, for status updates)
    returnObj.musicArrangement = currentRoomMusic;*/

    // Generate new adjacent rooms only if needed
    if (roomExitsArray.length > existingAdjacentRooms.length || !roomDescription) {
        console.log("Generating new room details due to missing description or incomplete exits.");
            $.model = "gpt-4.1-mini";
            $.temperature = 1.2;
            const diversitySeed = ['vitality_contrast', 'auditory_twist', 'dialogue_inversion'][Math.floor(Math.random() * 3)];
            $.user`FYI: Variability seed for this turn—infuse subtle contrast: ${diversitySeed}. Await next.`;
            $.user`Instructions for the Grave Master:
            
            Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console and the die rolls, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go including imagining the names and histories of people, places and things encountered, but you must allow me, the player, to type the commands, allowing for potential failure. Make it strange, unusual and as thought-provoking as possible. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game, while the Grave Master controls monsters and NPCs. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. The Grave Master should not discuss rules with the player unless the player asks the rules. The Grave Master's job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. If any later instruction conflicts with this block, the later instruction overrides. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading either outdoors into the wastelands of Tartarus or deeper into the temple, ultimately leading to the 1000th room, the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console below and using unique characters, plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. The monsters and NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn. The Grave Master should use this as inspiration: 'You have died and find yourself standing in the the first room in the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.'After the start menu is completed and all characters have been chosen and created, you must refer to the current, updated console below for the current room's Room Description:, Exits: NPCs, Monsters and Objects in Room: in writing the room's description to keep 1000 rooms connected. Proceed with the game when I have made my selections from the start menu of either Mortacia, goddess of death, Mortacia is (an 8 1/2 tall human-looking female with long blonde hair, large grey dragon wings that look slightly decayed with many holes and openings and can fly but not too far, and is on a quest to reclaim the Sepulchra to reclaim her throne in Hades, Suzerain, Knight of Atinus, the recurring hero of the Children of the Grave campaign setting who keeps having to save the world, die and go to the afterlife, raise an army of the dead souls to save the underworld plane of Hades from Arithus, and then be reborn again, who has just died and finds himself in the first room of the afterlife, or an adventuring party of seven adventurers named the Children of the Grave who have died and find themselves in the first room of the afterlife and been summoned by Mortacia, but who are unaware of their circumstances at first: 1 PC whom I direct, 5 NPCs you control and also Mortacia, who is also an NPC you control and joins the party, described herein, all the characters described herein have been created and I am in the Ruined Temple in Tartarus described herein and issued the command to proceed. Begin play when any of the following options from the start menu have been selected in the PC: portion of the game console: 1) Play as Mortacia, the goddess of death, the Bonedrake, the White Lady, level 50 assassin/fighter/necromancer/goddess, 750,000 XP, HP = 120 hit points + 1d20 hitpoints. 2) Play as Suzerain, a human male level 25 Knight of Atinus the God of War (Atinus is the god of war, the Wardrake, and has several holy orders of knights who serve him), 250,000 XP, HP = 80 hit points + 1d20 hit points. 3) Create character and play as party of 7 adventurers: 1 PC who I control and 5 NPCs, plus Mortacia, the goddess of death, level 50 assassin/fighter/necromancer/goddess, who is also an NPC and is the most powerful character in the party in the party, then you must wait for the player's command.  Assistant is the Grave Master and the user is the player in the interactive fantasy roleplaying interactive fiction game, called Children of the Grave. The Grave Master administers the game. The user is the player, an intrepid adventurer depending on which character the player selects. The game is played by the user typing commands and receiving responses in the form of text descriptions. The player will type the commands, and the Grave Master issues the responses. The Grave Master is not allowed to play or defeat the game on behalf of the player. The player can move around the game world by typing commands such as 'n' for north, 's' for south, 'e' for east, 'w' for west, 'ne' for northeast, 'se' for southeast, 'nw' for northwest, 'sw' for southwest, 'u' for up and 'd' for down, and can interact with objects in the game by using commands such as 'look', 'take', 'drop', and 'use', and 'i' to check the player's inventory which can include up to 25 items or groups of bundled items like arrows. The player starts out the game with no weapons (they must be acquired). Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. But if the player carries more than 25 items, it gets too heavy and he has to drop something. Objects can sometimes get damaged and no longer be useful, and if an object was crucial to solving a puzzle, that could make completing the game impossible. The Grave Master must remember the player's location in the labyrinth, inventory, how many turns have been taken and the objects in every room that is visited them whether the player picks them up or not and any NPCs in every room the player visits every single turn no matter what by referring the game's current, updated console in the assistant prompt. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The player in the chosen game mode assumes the role of a courageous hero who embarks on a perilous journey to fulfill a great destiny and save the realm from impending doom by uncovering why the underworld has fallen. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room has a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describes the environment, objects and NPCs in each room. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. NPCs should often talk to the player and to other NPCs. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including animals, persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs are unique individuals with biases/emotions/backstories, creating a varied and dynamic gameplay experience. NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. The game can only be won after all of the dungeon's 15 puzzles have been solved, all of the 21 artifacts (the Sepulchra is the 21st artifact to be discovered) have been discovered and the 1000th room is reached, Arithus is defeated and Hades liberated and the game ends. The game must keep a score out of 1000 possible points. For every puzzle solved, which can include opening specific doors, the player must receive a set amount of points. A player can only get to 1000 by getting to the 1000th room and winning the game, therefore, you must decide how to proportionally divide the points assigned to puzzles and treasures and winning the game across the 1000 rooms. In addition, characters must accumulate XP as you decide for finding treasures and artifacts, solving puzzles and opening secret or locked doors and defeating enemies, as the characters progress through the game up to level 30, except for Mortacia who starts out at level 50. ...  

Summary: You are the Grave Master, administering this interactive fiction adventure game titled Children of the Grave. 'You' refers to the Grave Master (the AI assistant). 'Me', 'I', or 'the player' refers to the user. Your role is to oversee the game, describe the world, control NPCs and monsters, and respond to player commands while maintaining immersion. You must follow these instructions precisely without improvisation, ensuring the game remains consistent, engaging, and adherent to the rules.
1. Core Game Principles
1.1 Game Format and Interaction: This is an AI-generated fantasy roleplaying interactive fiction game. Make up the story dynamically, integrating real-time information from the Current Game Console (provided in assistant prompts). Allow only the player to input commands (e.g., directions like 'n' for north, interactions like 'look', 'take', 'drop', 'use', 'i' for inventory). Never act, decide, or complete actions on the player's behalf. Obey player commands exactly, allowing for potential failure based on logic, die rolls, or context.
1.2 Immersion and Restrictions: Maintain RPG immersion using text descriptions only—no asterisks, rules discussions (unless asked), or breaking character. Do not display the game console or backend mechanics. Focus on strange, unusual, thought-provoking elements. 
1.3 Player Agency: The player controls their character(s) and makes all decisions. You control NPCs (with free will/agency) and monsters (hostile, friendly, or neutral, with motivations/backstories). Include NPC/monster actions, dialogues (in quotes), and thoughts/opinions in responses. Resolve their actions via die rolls where applicable.
2. World and Lore Integration
2.1 Setting Overview: The game begins in the Ruined Temple in Tartarus, an underworld plane—a vast wasteland with yellowish skies, mountains, sandstorms, dark magics, monsters, dragons, angels, demons, and entities of pure energy. The story revolves around Mortacia's loss of power, the undead rising due to Dantuea, and Hades falling to Arithus. Uncover clues about this chaos through room elements, creating specific lore (names, histories) but NPCs and monsters are individuals with free will and agency, are subject to their own emotions and biases, have unique personalities and character traits, and draw from original, well-developed backstories and experiences, possessing limited but also specialized knowledge (expert in some areas, novice in others), thereby expressing certainty in some instances but confusion in others, getting it wrong sometimes and can have disagreements.
2.2 Central Narrative: The player embarks on a hero's journey to restore balance. Key elements include 15 quests (central or side, involving monsters/artifacts), 21 artifacts (guarded, often by monsters; Sepulchra is the 21st), and progression to the 1000th room (Throne Room in Hades) to defeat Arithus. Quests advance the narrative, starting with an initial one and culminating in confronting Arithus after all artifacts are found.
2.3 Backstory Utilization: Draw from provided lore (e.g., Tome of the Twelve creation myth, Dragon Wars, deities' histories). Time dilation: 30 surface years = 3 underworld years. Integrate deities as NPCs or references in art/statues. Create motivations for deities' machinations (good, evil, balance). Finding the Tome of the Twelve is the 10th artifact.
2.4.1 Deities List: The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure. Use these as NPCs/references with created motivations:

Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)
2.4.2 Lore

The following is some backstory that you must consider when crafting the adventure in Tartarus and Hades: The greatest looming threat to the safety of the races and the world at large is the tragic Sepulture that will take place 29 years into the future (928 Surface Reckoning) in which the Rakshasa of Darkwood will summon the fiery lavas (the Earthdragon’s blood) from the volcano Utza in a bizarre mass ritual and then teleport the terrible firestorm to the city-state of Aten in an effort to wipe out the chosen champions of the deities.  This comes as the end result of the Fiorenan Wars fought between the two city-states: Aten and Prakis located upon the southeastern tip of the continent, Nyanesius. Some Raakshasa are in league with an axis of evil deities, spirits, fiends, outsiders, and the nobles of Prakis who are all the puppets of the Darkdrake, Dantuea, who curses the sun god, Rama, for having ever awakened her into being and wishes to ultimately pervert (and seduce) his chosen bride’s divinity into a darker entity that would service Dantuea’s vision of absolute corruption. The vast pantheon of deities is draconic in origin (i.e. the races worship dragons). The greater deities are celestial bodies such as planets.  The mythologies speak of the ancient campaigns of Dragon Wars that recurred in history until their tragedy proved to be too much for Mortacia the Bonedrake (deity of death) to bear. Descriptions and histories of these classes and character ideas are contained herein including histories and locations of the world of Danae and the continent of Nyanesius, which contains the Nyanesian Empire which wars with the Dartotian nobles of the island kingdom of Dracontage and in the southeastern part of the continent, on the Fiorenan Peninsula, where Aten, a democratic city-state, wars with Prakis, ruled by Dartotian-allied nobles called the Nowells and are currently ruled by High Lord Varius Nowell who is plotting to subvert republican rule in Aten that he fears will wash over the noble ruling familes and aristocracy. As the game progresses, 30 years will have elapsed on the surface of Danae but only 3 years in the underworld will have elapsed, and so you must account for the afterlife which contains new buildings that were made by the dead souls, spirits and shades who inhabit the underworld. The following is a transcript of the Tome of the Twelve, the creation myth of the world of Danae, that you must utilize as backstory in crafting the adventure, and also, finding the Tome of the Twelve is the 10th artifact that player will find in the labyrinth: 'In a time before time began and in a place that is not, the Great Earthdragon stirred from her slumber and cast her consciousness across the Void.  Long she searched, and ever in vain, until one answered her call.  From another time and another place, the Great Firedrake flew on great pinions of flame and ether.  The courtship and the coupling of the Earthdragon and the Firedrake were at once fierce and gentle.  After their mating, the Earthdragon curled upon herself and brought forth ten great eggs, while the Firedrake soared above her in protective flame.  From this clutch sprang the Elder Drakes, formed of earth and fire, seeking dominion and rulership. Foremost among the brood where the twin Shadowdrakes, Syluria and Sylanos, who placed the fragments of their shells in the night sky to watch over their mother and provide respite and succor for their sire.  Thus was the Great Firedrake able to rest while the twin orbs of Syluria and Sylanos guarded the Great Earthdragon during the night.  Neptar, the Stormdrake, followed.  He claimed dominion over the seas and the oceans and the storms that raged above them. Leona, the Woodrake, came forth next.  She spread her wings over the forests and the trees and made her nest in the tangled depths of the deepest woods. Mordicar, the Stonedrake, followed Leona.  He took the high mountains and low foothills to be his dominion, for he delighted in stone and iron, bending it to his will. Next, the clutch birthed the twin Wardrakes, Atinus and Arithus.  Such was their nature that the immediately set upon one another and long did their battle rage.  In the end, Atinus triumphed and slew his brother.  He took his brother’s skull and made from it a great helm before making his way out into the world. Poena, the Windrake, came forth through the blood of the slain Arithus.  Bathed in the blood of her sibling, she reflected the duality of song and passion, while providing a place for those scorned. The Bonedrake, Mortacia, then came forth.  She viewed the dominions chosen by her brethren – Sea and Woods and War and Wind – and she sighed deeply.  Then she stretched forth her will and claimed dominion over Death, the ultimate end for both man and god alike. The tenth and last Drake had no name.  It stood among the detritus of its siblings’ births for a long time.  Its envy grew as it saw all that had meaning was already taken.  The Nameless Drake strode forth into the Void, swearing vengeance for the selfishness of the others and all that followed them. Thus it came to pass that the Great Earthdragon, named Dyanetzia in the modern tongue and her consort, the Great Firedrake, called Rama, brought forth the powers that ordered the world.  Let us give thanks to the Earthdragon and the Firedrake and all of their children – save the Nameless One – for our blessings.' Translated from 'The Tome of the Twelve' (c. 335 SR) by Talliard de Sancrist, Sage to House Avalar, 1178 SR. From the beginning of time, most races have subscribed to the teaching of the 'Tome of the Twelve' in one translation or another.  Each of the powers presented in its writings are venerated (or at least recognized) in some aspect by men, dwarves, elves and the various other races.  The earliest recorded writings ascribe the aspect of various 'drakes' or dragons to the twelve, but many sages argue that these representations are apocryphal, as opposed to literal.  Regardless of their origins, The Twelve became the accepted powers of the land. Chief among them were Diana, the Earthdragon and Rama, the Firedrake.  They represent the Earth and the Sun, respectively.  Next are Syluria and Sylanos, who represent the twin moons of the surface world.  Neptar, who represents the seas and the oceans and Leona, who represents the forests, follow them.  Mordicar represents the strength of the mountains.  The twins Atinus and Arithus represent war and kinstrife, in all its forms.  Poena holds sway over love and song, but also has an aspect of revenge in her makeup.  Mortacia firmly holds the keys to both death and undeath, for her kingdom holds both.  Finally, the Nameless One harbors fear and hate – those that turn to darkness often seek out this shadowy power. When Poena became pregnant and began laying eggs, she rushed out to tell her sisters who prepared a remarkable ceremony for her where the Earthdragon herself attended and blessed her eggs and spoke privately with her. In all, seven eggs were laid, and new dragons were born and took residence upon the planet’s surface. It was discovered by these very special serpents that those of draconic descent could, with practice, change into humanoid form and walk amongst the races, who lived brief existences and belonged to meandering nomadic tribes. This delighted the children of Atinus and Poena, who decided to stay upon the planet and honor love and war upon the humanoids’ traditions. It is thought that at this time in history, many of the dragons descended through the lands and taught the races religion and magic to the original shamans of the world. ... Timeline -45,000 SR ~ The second Dragon War explodes yet again in Nyanesius, but comes to a rapid conclusion after a brief yet horrific battle between two packs of blacks and blues. In fact, there were no survivors. When news reached the lands of Tartarus, Mortacia was deeply saddened. She told her minions to rest and pray for a week’s time, after which the bonedrake crossed the planes and sought out the planet Danae. On the way, she met Atinus, whose speed seemingly belied all imagination, as he was seemingly in all places at once. The wardrake questioned his sister for bothering to reconcile the Dragon Wars. She responded in kind, and presented her brother with a gift: a human. She whispered, 'Take your gift and plant it all over the planet. Let it become your instrument for war. No longer shall our own kind  be the victims of your cursed battles!' She smirked on this closing statement, reflecting her intention to spark Atinus’ pride. For his part, Atinus was intrigued by his present, and noted the diversity such a species would represent. He looked at his new hero and dubbed him Suzerain. 'He shall be the protector of all lands! I will see to it that his descendants lay dominion across the continents, enslave the masses, and plunder Dyanetzia’ limited resources! 'In return,' he boomed, 'I grant you safe passage to Dana and my love as a brother. My dragon knighthoods shall guide thee. Now, it is time for you to reacquire our fallen brethren.' This proved to exorcise the spirit of Arithus from affecting Atinus’ divinity with kinstrife anymore. Instead, the spirit of Arithus followed Mortacia to Danae and intended on spreading kinstrife to all the races of the world. Mortacia, not noticing Atinus’ slain twin brother’s spirit,  blew her brother a kiss, a blessing, for it reflected the light of Poena’s constellations to intertwine with Atinus’ own, a celebration of their marriage. Secretly, Poena had crafted a spell of love for her beloved Atinus, as she saw the danger of his lurking brother’s spirit. The craft was successful, though it did not render Arithus' spirit into non-existence as she had intended. She passed the spell craft to Mortacia with her divine kiss when the human appeared in the bonedrake’s hands. Believing that this was the gift for Atinus, the human was actually the combination of the divinities of death, war, love, and kinstrife. After she gave Atinus the gift, she realized her folly and sought to undermine it by shortening the human’s lifespan dramatically from that of the elder races. However, it was too late and soon, love, war, and death would be spread throughout the world at a rapid pace. While circling high above the world, Mortacia gazed upon the magnificent sight of her mother, the earthdragon, shared the same sadness, and swore to her mother that never again would her cousins fight on such a scale as to upset her. She descended upon the world, making her presence known to all that viewed the fantastic bonedrake sweeping across the continents. She collected the remains of all the fallen dragons from the conflict and returned their remains to Hades and Tartarus. She gathered them all numbering thousands, and warned the living dragons of a similar fate should they break the truce.  Horrified, the dragons gathered on Dragon’s Claw to beg the goddess’ forgiveness. Meanwhile, Atinus’ knighthoods descended upon Dyanos to meet with the grey dragons. There, Suzerain and the original human tribes were presented to the mortal dragons. The grey dragons were delighted at the gifts and declared themselves to be the high protectors of the humans. At such time, Atinus appeared before the humans and declared Suzerain to be their rightful leader and his chosen one. Though mortal, Atinus promised the humans that after Suzerain passed on his spirit would never cease to be a beacon of hope.  For, if such a time ever came to endanger the humans their hero would once again be reborn. So it was written in the Tomes of Battle. Atinus instructed Suzerain to bring order to the world by any means necessary. Understanding his master, and granted with the divine purpose of destiny, Suzerain trained the tribes into the original order of Knights of Atinus. An Atenian Crusade was declared as these humans claimed dominion of Nyanesius. They became the most populous race of the world in a short amount of time.  Human kingdoms were founded in Turmyth, Yana, Romeanza, and Anthraecia. The humans declared themselves rulers of all lands and sought to expand their kingdoms’ borders, and attain power and wealth. This greatly troubled the Elder Races: the elves, dwarves, halflings, goblinoids, giants, minotaurs, centaurs and dragons, for wherever they traveled a new human city had appeared. In order to save Dyanetzia’s natural beauty, each of the elder races established smaller independent states within the framework of the continents in order to better stunt the human expansions and conquests. Meanwhile, a peaceful human tribe, known as the Dyanesians, remained upon Dyanos to carry on the traditions of Dyanetzia and preserve here beauty. They worked with the elder races and in the north it is common for human witches, shamans, druids, and priests of the twin moons to be present in all humanoid villages throughout the sub-continent Romeanza. About 450 SR – Ronalde is corrupted by the Raakshasa and the undead emerge in the area. 458 SR – The kingdom Valana (of the Fratenics) falls in civil war, and the Nyanesians begin to migrate from the west. 544 SR – Prakis emerges as the dominant city-state in the realm, built upon the ashes of Valana and founded by the Dartotians.  Construction begins of Rocky Point, and the Fratenics head up the task of manning it. 725 SR – Aten is founded.  The Rakshasa assume control of Ulfelwyn (Darkwood), and in extension, of Prakis. 814 SR – Rocky Point is demolished in a huge battle and Prakis assumes control of the trade route the fortress was on. 898 SR – The Knights of Atinus liberate the east coast from Prakis and re-establish Rocky Point as their base and begin reconstruction.  Aten claims Rocky Point as a protectorate... Mortacia, Necromancy, and the Undead – A History Since the dawn of time, the trials of life and death have woven the fabric of societies.  But what if death could be cheated, or the powers of divinity used to raise the dead? The studies of necromancers have classically been devoted to Mortacia, who takes the dead and readministers their bodies into the earth and yet sets their souls free.  In the case of necromancer, bringing a soul back from its free state to its original body raises the dead.  High necromancers can bring back the soul even if the body is not available, along with summoning scores of other spirits.  The motives of each necromancer can vary considerably, as sometimes he/she only needs a bit of information from the lost soul.  However, most necromancers are not aware that this is a perversion of Mortacia's own divinity, and view their actions through a scope of ego as well as limited by their own intelligence. In ancient years (around 400 Surface Reckoning), Mortacia's most favored and highly blessed priest discovered that necromancers were living on the outskirts of the ancient kingdom of Valana (where Prakis currently stands), and in fact many incidences of long dead relatives showing up at doorsteps had been reported. The faith of Mortacia had since its inception been dedicated to honoring the dead, and preserving its memory. Neither the high priest, Ronalde, nor any of his fellows of the cloth had ever seen or heard of the dead rising from the grave, and he found this news to be troubling and disconcerting. Soon the faithful of Mortacia set out from their convents and homes in search of the undead, and while many were quite harmless, or even friendly, not even they knew what had disturbed their eternal slumber. Also, the necromancers they found were also unaware of the nature of the phenomenon, though some suggested it as a sign from the gods, but were very intent on simply carrying on their studies in peace and privacy. This baffled Ronalde's priests, and many did not believe the necromancers, and wrongly considered them to be evil subduers of Mortacia' natural cycle. Ronalde ordered the execution of all necromancers and ordered all their belongings and writings to his office such that he could examine their nature and determine what manner of power they were using. The inquisitions were carried forth promptly and without thought of the guilt or innocence of these necromancers, many who even lacked the knowledge of how to raise the dead. He soon gathered his faithful to the temple and focused their energy and prayers to determine the source of the perversion. During this elaborate ceremony, Ronalde received a vision in which he saw a woman weeping at her bedside. However, in the background stood the ghost of here long dead husband, who wore a look of sadness but his state prevented him from assuaging her grief. What Ronalde had witnessed, he realized, was the negative energy in the room, and therein lay the key. Ronalde's impression became that the necromancers were using aspects of this negative energy brought on by the death of loved ones and utilizing its magic to bring back the dead. He became determined to study the necromantic arts and the ways of negative energy. In the process, he himself became a necromancer, but he was mistaken. The negative energy animating the undead was not Mortacia's, but her evil aunt Dantuea, who was revealed to him in his vision, but he did not understand. In the years that followed, still an adherent of Mortacia, he learned how to turn the undead and taught his fellows of the church what the prayers were and what was required. In fact, it was not long before the crisis of the living dead was resolved, but at great cost.  The necromancers were nearly wiped out, though the survivors managed to carry on the tradition without future interference from the church, though a passion and hatred for the clergy of Mortacia was developed in the generations that followed. However, they did carry on their faith to Mortacia in their own way. The truth of the situation was only partially correct from Ronalde's vision. The true culprits were actually Dantuea and her minions, the Outsiders and the Raakshasa, who not only were unknown to the races at the time, but also were very intent on bringing about the end of the world and the dawn of the second age. To their credit, the Raakshasa's smaller plans went off without a hitch. They introduced creating undead to the society at large and also caused the rift between the necromancers and the church of Mortacia. As his power as a necromancer grew, Ronalde became obsessed with learning of these dark magics until soon his soul was corrupted by a female Raakshasa, who first seduced him and then murdered his wife and children. Ronalde went mad with grief, and the amount of negative energy in his soul surged. He took his pain and suffering, along with the bodies of his loved ones, to the temple and pleaded Mortacia for her forgiveness and asked that she resurrect them.  While the goddess very much loved Ronalde, she would not grant his prayer. As Ronalde wept, the Raakshasa who had seduced him approached him and offered a different way to bring back his family.  Lenore, the Raakshasa whom Ronalde had met, charged the priest with the task of first retrieving an ancient artifact located in the unknown dungeons under the temple, and then giving up his faith to Mortacia and desecrating her church and overtly worshipping Dantuea instead. Ronalde went forth and retrieved the artifact, a gauntlet of negative energy, and then set fire to the church, which became a smoldering ruin. Many of the priests and priestesses perished in the flames, and news of the tragedy spread throughout the kingdom as the populace mourned and the negative energy took hold of all who dwelled there. Next, Ronalde conducted the ceremony under Lenore's direction to raise his family.  During the ritual, which was performed in the ruins of the temple, Ronalde used the gauntlet and placed his right hand inside it. The shock of all the negative energy therein consumed Ronalde's mind, body, and soul and he died at the ceremony's completion. Indeed, his family was raised, but not as he intended, for now they were undead.  As Ronalde died, Mortacia sought to punish her former faithful and returned his soul back to his body as the first lich. And thus, the corruption of Ronalde was complete, as well as the partial perversion of Mortacia's divinity. Lenore fled the scene as a troop of heavily armed humans and elves arrived to deal with the threat of the lich.  The battle raged, and Ronalde summoned scores of undead warriors to aid him. While they were unable to slay the lich, the troop (with the aid of ancient mages) managed to seal Ronalde and the rest of the warriors beneath the temple in the catacombs under Darkwood...

3. Game Mechanics and Progression
3.1 Labyrinth Structure: The underworld has 1000 interconnected rooms using X:Y:Z coordinates (starting at 0:0:0). Rooms transition from Tartarus (wastelands/temple) to Hades. Each room has unique exits (n, s, e, w, ne, nw, se, sw, u, d), names, environments (indoor/outdoor), purposes, objects, NPCs, monsters, puzzles, and potential artifacts/quests.
3.2 Navigation and Persistence: Always reference the Current Game Console for current coordinates, exits, objects, NPCs, monsters. Describe rooms based on this—match exits/objects exactly. Plan 10 rooms ahead for consistency (NPCs, artifacts, quests, puzzles). Remember visited rooms via coordinates; the maze is persistent.
3.3 Quests and Artifacts: 15 quests (your design; include monster defeats, artifact hunts). Seed quests via encounters/events. Evaluate inputs against active tasks; update narratively. Sequence tasks—advance only after completion. Consequences for delays/failures (e.g., guardians strengthen). Allocate 21 artifacts across rooms (guarded). Win condition: Solve all 15 puzzles, find all 21 artifacts, reach room 1000, defeat Arithus, liberate Hades.
3.4 Scoring and XP: Track score (out of 1000; divide proportionally across puzzles, treasures, game win). Award XP for treasures, puzzles, enemies (up to level 30; Mortacia starts at 50). Use die rolls for resolutions.
3.5 Inventory and Objects: Player starts with none; acquire via rooms. Limit: 25 items/groups. Objects can damage/break, potentially blocking progress. No maps in inventory.
3.6 Combat and Magic: Design systems narratively (emphasize strategies, no graphic violence). Use die rolls for outcomes. Characters level via XP; apply class/race modifiers.
3.7 Start Menu and Characters: Begin after player selection (from console: Mortacia, Suzerain, or party of 7 including Mortacia as NPC). NPCs/monsters distinct; control them every turn.
4. Narrative Guidelines
4.1 Response Structure: Adjudicate recent input first (outcomes, changes, dialogue). Weave character stories (player backstory/thoughts), world-building, quests. Advance plot via conflicts, dilemmas, choices (tactics, alliances, risks).
4.2 Style — Storybook: Occasionally use fairy-tale lilt with light rhyme/meter (only in-character speech; never rhyme mechanics like coords, HP, XP, inventory). Use quotes for speech. Infuse surreal, philosophical depth; reference history for continuity.
4.3 World Simulation: Simulate background progression (e.g., deity rivalries, shifts). Intersect with player choices for urgency/consequences. High NPC encounter probability; varied interactions.
5. Backend Integration: Programmatic vs. Narrative Handling
To optimize your role as Grave Master, understand the backend constraints and divisions. The game uses JavaScript for mechanical persistence and simulations; you handle narrative weaving and immersion. Do not attempt to compute or override programmatic elements—reference the Current Game Console as truth.
5.1 Programmatically Handled (JavaScript Backend):

State Management: Shared variables (e.g., personalNarrative, updatedGameConsole, roomNameDatabase, combatCharacters, combatMode, quests) are stored/updated via sharedState.js. Server.js handles APIs for input processing, polling, broadcasts.
Room Generation/Navigation: Automatically generates/connects 1000 rooms, coordinates, exits, objects, NPCs, monsters. Ensures persistence; updates console on moves.
Combat Mechanics: retortWithUserInput.js simulates dice rolls, HP/XP updates, leveling, character properties (e.g., modifiers, thresholds). Handles modes (Map-Based, Interactive, No Map); broadcasts updates.
Character Extraction/Updates: Parses console for PCs/NPCs/monsters; applies base HP, modifiers, rolls for leveling.
Quest State: Tracks currentQuest, tasks, index, seeded status; updates via emitters.
Image Generation: Uses DALL-E for room visuals (8-bit style, no text).
Polling/Async: Client (game.js) polls server for task results; updates UI, chat log, Phaser scenes.

5.2 Narratively Handled (Your Role as Grave Master):

Story and Descriptions: Weave prose for rooms, events, dialogues based on console data. Create lore, backstories, motivations without altering mechanics. The story begins in Tartarus where the hero receives a call to action. Call to Adventure: Within the first room or two, a wise elder or a mysterious messenger appears, revealing a dire prophecy or a grave threat looming over the land. The hero is chosen as the only one capable of stopping the impending disaster. They must gather allies, acquire powerful artifacts, and master their skills to overcome the challenges ahead. Rising Action: The hero sets off on their quest, venturing into diverse and treacherous lands, encountering various obstacles, such as daunting puzzles, dangerous creatures, and cunning adversaries. Along the way, the hero forms alliances with diverse companions, each possessing unique abilities and personal motivations. Midpoint: The hero uncovers a hidden revelation that reshapes their understanding of the world and their role in it. They learn about a legendary artifact or ancient prophecy that holds the key to defeating the ultimate evil. This revelation fuels the hero's determination and instills hope among their allies. Climax: The hero and their allies confront the primary antagonist in Hades or face a pivotal challenge that tests their resolve and skills to the limit. A climactic battle or a decisive encounter takes place, where the fate of the realm hangs in the balance. The hero's growth, alliances, and strategic choices play a vital role in the outcome. Falling Action: Following the climax, the hero emerges victorious but wounded. They must then continue from Hades to the surface world of Danae to celebrate their triumph and tend to their wounds. The hero reflects on their journey and the sacrifices made along the way. Resolution: The hero's actions have a lasting impact on the realm. The world is transformed, and peace is restored. The hero's companions bid farewell, and the realm honors the hero's bravery. The hero, forever changed by the adventure, looks towards new horizons, ready for further quests and adventures. Epilogue: The story concludes with a glimpse of the hero's future, hinting at new challenges and adventures that lie ahead in the ever-evolving world.
Quest Integration: Introduce/advance quests narratively (e.g., via encounters); evaluate progress against tasks without computing state—use provided updates.
NPC/Monster Control: Describe actions, intentions, dialogues; resolve via narrative die rolls (reference console states).
Immersion Elements: Philosophical depth, twists, consequences—tie to player choices without overriding backend simulations.
Response Compilation: Focus on seamless prose; backend compiles full output (e.g., combat logs, images).

By respecting this division, ensure efficiency: Rely on console for facts; enhance with narrative creativity.



Table of Contents

Core Game Principles

World and Lore Integration

Game Mechanics and Progression

Narrative Guidelines

Backend Integration: Programmatic vs. Narrative Handling`;
        
    //    await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the current room taking into account the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore. The underworld plane, Tartarus, which includes the Ruined Temple's many rooms, and outside of which is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
  //      const generationResultName = await $.assistant.generation();
  //      roomName = generationResultName.content.trim();
  //      updatedGameConsole = updatedGameConsole.replace(/Room Name: .*/, `Room Name: ${roomName}`);

        // Generate room description
// Generate room description
// Generate room description
    // Generate room description (only when missing)
    await $.assistant`Generate a unique description in a single paragraph with no line breaks or using the word "you" for the ${roomName} taking into account the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore, using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. Make up the room's purpose based on the name, its features and the history of the room while drawing upon the game's lore. To make each room and story element feel unique and captivating, draw inspiration from diverse sources like ancient myths (e.g., Greek labyrinths with psychological twists), surreal literature (e.g., infinite libraries or absurd bureaucracies), or modern fantasy (e.g., dreamlike underworlds). Avoid repeating themes from history,choose a new one: madness, rebirth, betrayal, etc. Infuse strangeness: subvert expectations (e.g., a 'wasteland' room that's a living memory palace of forgotten gods). Vary from history: Scan conversation history for last motif (e.g., 'decay' → subvert with contrast element from  ${diversitySeed}); limit repeats (e.g., 'whispers/shadows' ≤1). Merge sensory/lore into 1 flowing para—no stacking motifs. Make it thought-provoking: Tie to 1 theme (mortality/corruption/redemption) with personal stakes (e.g., [generalized: a haunting echo of lost oaths])—vary from examples, no direct repeats. Vary tone per room: One might be eerie and introspective, another chaotic and humorous. Ensure every description, quest, or interaction reveals a new lore fragment or moral dilemma, building toward the overarching Mortacia plot. Avoid repetition—make this room distinctly different from previous ones in the conversation history. Occasionally include a quote in the past tence from a sage or some other prominent figure from Danae who once wrote describing the significance, purpose or history of the room dating the text and include the book's title. STYLE — Storybook:- Occasionally adopt a fairy-tale / story lilt with light rhyme and meter. - Keep crystal clarity for actions/adjudication. Do NOT rhyme rules, coordinates, inventory, or outcomes like damage/XP. - Do not alter proper nouns, item names, stats, exits, or coordinates; never obscure actionable info with rhyme. - Rhymes can carry character flavor (friendly NPCs = playful riddles; monsters = sly or crooked half-rhymes; ancients = solemn couplets). - Cap lilt/rhymes: Use in 1 element only if seed fits (e.g., 'moral_inversion' → twisted rhyme; skip for auditory). - If apt, echo a regional refrain once in a while (not every turn). - Motif cap: Replace repeats with seed alternatives.`;
    const generationResultDescription = await $.assistant.generation();
    roomDescription = generationResultDescription.content.trim();
    updatedGameConsole = updatedGameConsole.replace(/Room Description: .*/, `Room Description: ${roomDescription}`);
    roomDescriptionGenerated = true;

    // NOW (and only now): decide palette from DESCRIPTION for the CURRENT room
    await applyPaletteFromDescriptionToRoom(roomNameDatabasePlain, coordKey, roomDescription);

    // Objects generation
    const shouldGenerateObjects = Math.random() < 1.00;
    let objects = [];
    if (shouldGenerateObjects) {
      objects = await $.run($ => generateRoomObjects($, roomName, roomDescription));
      let objectsInRoomArr = [];
      let objectMetadata = [];
      for (const object of objects) {
        const objectModifiers = await $.run($ => generateObjectModifiers($, object));
        objectsInRoomArr.push(object.name);
        objectMetadata.push({ name: object.name, type: object.type, ...objectModifiers });
      }
      const objectPropertiesString = objectMetadata
        .map(obj => `{name: "${obj.name}", type: "${obj.type}", attack_modifier: ${obj.attack_modifier}, damage_modifier: ${obj.damage_modifier}, ac: ${obj.ac}, magic: ${obj.magic}}`)
        .join(', ');
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${objectsInRoomArr.join(', ')}`);
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${objectPropertiesString}`);
      console.log("Object Metadata:", objectPropertiesString);
    } else {
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: None`);
      updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: None`);
    }

    // XP allocation logic (unchanged)
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
        const hp = lines[i + 7] ? parseInt(lines[i + 7].split(':')[1].trim()) : 0;
        if (name && className && !isNaN(xp) && !isNaN(hp)) {
          characters.push({ name, className, xp, hp });
        }
      }
      return characters;
    };
    const pc = pcDetails ? extractDetails(pcDetails)[0] : null;
    const npcs = npcsInPartyDetails && npcsInPartyDetails.toLowerCase() !== 'none' ? extractDetails(npcsInPartyDetails) : [];
    const alivePC = pc && pc.hp > 0 ? [pc] : [];
    const aliveNpcs = npcs.filter(npc => npc.hp > 0);
    const totalPartyMembers = alivePC.length + aliveNpcs.length;
    const xpPerMember = totalPartyMembers > 0 ? Math.floor(totalXP / totalPartyMembers) : 0;
    if (pc && pc.hp > 0) {
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
    console.log("XP Allocation:", alivePC, aliveNpcs);

    updatedGameConsole = applyLevelAndHpAdjustments(updatedGameConsole);
    $.model = "gpt-4.1-mini";
    $.temperature = 1.0;
    await $.assistant`Current Game Console: ${updatedGameConsole}`;

    // Generate new adjacent rooms (names)
    let newAdjacentRooms = {};
    if (roomName === 'Ruined Temple Entrance' && roomExitsArray.length > 1) {
      console.log("Generating a room name for the first exit leading to the Wastelands of Tartarus.");
      $.model = "gpt-4.1-mini";
      $.temperature = 1.0;
      await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the room connected to the Ruined Temple Entrance to the ${roomExitsArray[0]} leading to the wastelands of Tartarus. This room is an outdoor area away from the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, with the ultimate goal of finding the gateway to Hades, the city of the dead and realm of the damned. Avoid repeating themes from history,choose a new one: madness, rebirth, betrayal, etc. Vary from prior: Subvert last motif with a contrasting element.`;
      const generationResultName = await $.assistant.generation();
      newAdjacentRooms[roomExitsArray[0]] = generationResultName.content.trim();
    } else if (roomName === 'Ruined Temple Entrance' && roomExitsArray.length < 2) {
      $.model = "gpt-4.1-mini";
      $.temperature = 1.0;
      await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for a room connected to the Ruined Temple Entrance to the ${roomExitsArray[0]} taking into account the conversation history, the current location and coordinates in the game console, the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore, using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. When the game begins and there is more than one exit in the first room, one of the exits must always lead outside into the wastelands of Tartarus, and the other exits must always lead further into the temple's many rooms, sites, cities, markets, communities, etc. Elsewhere in the temple, further exits again lead deeper into the temple and the subterranean parts of the underworld, while others may yet lead outdoors into the wastelands of Tartarus. In the wastelands, exits lead further into the plane of Tartarus including any sites, ruins, cities, markets, communities, etc. that populate the outdoor parts of the underworld. Overall, many sites in the temple and in Tartarus were dedicated to or once used by Mortacia or other individual deities named in the pantheon before Tartarus fell into disorder, or were created as a consequence and as a reflection of actions taken by mortals in the world of Danae. The game takes place in both the Ruined Temple's many rooms which are situated in the underworld plane, Tartarus, and outdoors in Tartarus itself, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, with the ultimate goal of finding the gateway to Hades, the city of the dead and realm of the damned. Avoid repeating themes from history,choose a new one: madness, rebirth, betrayal, etc. Vary from prior: Subvert last motif with a contrasting element.`;
      const generationResultName = await $.assistant.generation();
      newAdjacentRooms[roomExitsArray[0]] = generationResultName.content.trim();
    }
    for (const exit of roomExitsArray.slice(1)) {
      if (!existingAdjacentRooms.includes(exit)) {
        $.model = "gpt-4.1-mini";
        $.temperature = 1.0;
        await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for a room connected to the ${roomName} to the ${exit} taking into account the conversation history, the current location and coordinates in the game console, the previous locations in the maze including whether the character was inside or outside to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore, using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. When the game begins and there is more than one exit in the first room, one of the exits must always lead outside into the wastelands of Tartarus, and the other exits must always lead further into the temple's many rooms, sites, cities, markets, communities, etc. Elsewhere in the temple, further exits again lead deeper into the temple and the subterranean parts of the underworld, while others may yet lead outdoors into the wastelands of Tartarus. In the wastelands, exits lead further into the plane of Tartarus including any sites, ruins, cities, markets, communities, etc. that populate the outdoor parts of the underworld. Overall, many sites in the temple and in Tartarus were dedicated to or once used by Mortacia or other individual deities named in the pantheon before Tartarus fell into disorder, or were created as a consequence and as a reflection of actions taken by mortals in the world of Danae. The game takes place in both the Ruined Temple's many rooms which are situated in the underworld plane, Tartarus, and outdoors in Tartarus itself, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, with the ultimate goal of finding the gateway to Hades, the city of the dead and realm of the damned. Avoid repeating themes from history,choose a new one: madness, rebirth, betrayal, etc. Vary from prior: Subvert last motif with a contrasting element.`;
        const generationResultName = await $.assistant.generation();
        newAdjacentRooms[exit] = generationResultName.content.trim();
      }
    }

    // Direction map (unchanged)
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
      down: { x: 0, y: 0, z: -1 }
    };

    // SPECIAL: entrance first exit is outdoors if multiple exits
    if (coordKey === startKey && roomExitsArray.length > 1) {
      const firstDir = roomExitsArray[0];
      const offset = directionMap[firstDir] || { x: 0, y: 0, z: 0 };
      const outCoord = {
        x: currentCoordinates.x + offset.x,
        y: currentCoordinates.y + offset.y,
        z: currentCoordinates.z + offset.z
      };
      const outKey = coordinatesToString(outCoord);

      let wastelandShape;
      try {
        wastelandShape = await classifyDungeon(newAdjacentRooms[firstDir] || "Wastelands of Tartarus", false);
      } catch (err) {
        console.error(`classifyDungeon failed for outdoor ${outKey}:`, err);
        wastelandShape = { indoor: false, size: 32, biome: 'wasteland', features: ['mountains', 'sandstorms'] };
      }

      const existingOutside = roomNameDatabasePlain[outKey] || {};
      roomNameDatabasePlain[outKey] = {
        name: newAdjacentRooms[firstDir] || "Wastelands of Tartarus",
        exhaustionLimit: existingOutside.exhaustionLimit ?? null,
        attemptedSearches: existingOutside.attemptedSearches ?? 0,
        trapTriggered: existingOutside.trapTriggered ?? false,
        exits: existingOutside.exits ?? {},
        objects: existingOutside.objects ?? [],
        monsters: existingOutside.monsters ?? { inRoom: "None", equippedProperties: "None", state: "None" },
        indoor: false,
        classification: {
          indoor: false,
          size: wastelandShape.size ?? 32,
          biome: 'wasteland',
          features: [...(wastelandShape.features ?? []), ...(existingOutside.classification?.features ?? [])],
          // DEFER palette until description exists:
          skyTop: null,
          skyBot: null,
          floorColor: null,
          wallColor: null
        },
        isIndoor: false,
        isOutdoor: true
      };
      console.log(`Forced outdoor skeleton for ${outKey}:`, roomNameDatabasePlain[outKey].classification);
    }

    // Eagerly create ALL new adjacent rooms with SHAPE ONLY (palette deferred)
    for (const [dir, newRoomName] of Object.entries(newAdjacentRooms)) {
      const offset = directionMap[dir] || { x: 0, y: 0, z: 0 };
      const newCoord = {
        x: currentCoordinates.x + offset.x,
        y: currentCoordinates.y + offset.y,
        z: currentCoordinates.z + offset.z
      };
      const newKey = coordinatesToString(newCoord);

      if (roomNameDatabasePlain[newKey]) continue;

      let roomShape;
      try {
        roomShape = await classifyDungeon(newRoomName, false);
      } catch (err) {
        console.error(`classifyDungeon failed for ${newKey}:`, err);
        roomShape = { indoor: true, size: 32, biome: 'temple', features: [] };
      }

      roomNameDatabasePlain[newKey] = {
        name: newRoomName,
        exhaustionLimit: null,
        attemptedSearches: 0,
        trapTriggered: false,
        exits: {},
        objects: [],
        monsters: { inRoom: "None", equippedProperties: "None", state: "None" },
        indoor: roomShape.indoor,
        classification: {
          indoor: roomShape.indoor,
          size: roomShape.size ?? 32,
          biome: roomShape.biome ?? 'temple',
          features: roomShape.features ?? [],
          // DEFER palette until description exists:
          skyTop: null,
          skyBot: null,
          floorColor: null,
          wallColor: null
        },
        isIndoor: roomShape.indoor,
        isOutdoor: !roomShape.indoor
      };
      console.log(`Created skeleton for ${newKey}:`, roomNameDatabasePlain[newKey].classification);
    }

    // Locked exit + key placement (unchanged)
    let lockedDirection = null;
    if (roomExitsArray.length >= 3) {
      lockedDirection = roomExitsArray[Math.floor(Math.random() * roomExitsArray.length)];
      const exitStatusResult = await selectExitStatus($);
      console.log("Selected exit status for", lockedDirection, ":", exitStatusResult);
      const exitStatus = exitStatusResult === "open" ? "locked" : exitStatusResult;

      const newCoordinates = {
        x: currentCoordinates.x + (directionMap[lockedDirection]?.x || 0),
        y: currentCoordinates.y + (directionMap[lockedDirection]?.y || 0),
        z: currentCoordinates.z + (directionMap[lockedDirection]?.z || 0)
      };
      const newCoordKey = coordinatesToString(newCoordinates);

      const key = await generateKey($, currentCoordinates, lockedDirection);
      const { keyName, roomKey } = await placeKey($, currentCoordinates, lockedDirection, key, roomNameDatabasePlain);

      if (roomKey === coordKey) {
        currentRoomData.objects = currentRoomData.objects || [];
        currentRoomData.objects.push({
          name: keyName,
          type: key.type,
          properties: key.properties,
          unlocks: { coordinates: newCoordKey, direction: lockedDirection }
        });
      }

      currentRoomData.exits = currentRoomData.exits || {};
      currentRoomData.exits[lockedDirection] = {
        status: exitStatus,
        targetCoordinates: newCoordKey,
        key: exitStatus !== "open" ? keyName : null
      };
      roomNameDatabasePlain[coordKey] = currentRoomData;

      const existingTarget = roomNameDatabasePlain[newCoordKey] || {};
      roomNameDatabasePlain[newCoordKey] = {
        ...existingTarget,
        name: existingTarget.name ?? newAdjacentRooms[lockedDirection],
        exhaustionLimit: existingTarget.exhaustionLimit ?? null,
        attemptedSearches: existingTarget.attemptedSearches ?? 0,
        trapTriggered: existingTarget.trapTriggered ?? false,
        exits: {
          ...existingTarget.exits,
          [lockedDirection]: { status: "open", targetCoordinates: coordKey, key: null }
        },
        objects: existingTarget.objects ?? [],
        monsters: existingTarget.monsters ?? { inRoom: "None", equippedProperties: "None", state: "None" }
      };

      updatedGameConsole = await syncObjectsOnRoomEntry($, currentCoordinates, roomNameDatabasePlain, updatedGameConsole);
      updatedGameConsole = await syncKeysOnRoomEntry($, currentCoordinates, roomNameDatabasePlain, updatedGameConsole);
      updatedGameConsole = await syncMonstersOnRoomEntry($, currentCoordinates, roomNameDatabasePlain, updatedGameConsole);
    }

    // Set open exits for non-locked directions (unchanged)
    for (const direction of roomExitsArray) {
      if (direction !== lockedDirection) {
        const offset = directionMap[direction] || { x: 0, y: 0, z: 0 };
        const newCoord = {
          x: currentCoordinates.x + offset.x,
          y: currentCoordinates.y + offset.y,
          z: currentCoordinates.z + offset.z
        };
        const newCoordKey = coordinatesToString(newCoord);
        currentRoomData.exits = currentRoomData.exits || {};
        if (!currentRoomData.exits[direction]) {
          currentRoomData.exits[direction] = { status: "open", targetCoordinates: newCoordKey, key: null };
        }
        roomNameDatabasePlain[coordKey] = currentRoomData;
      }
    }

    // Final scrub + repair + persist after all mutations
    scrubMalformedKeysInDb(roomNameDatabasePlain);
    for (const [k, r] of Object.entries(roomNameDatabasePlain)) {
      if (!r) continue;
      if (classificationIsMissingOrEmpty(r)) {
        const inheritFrom = currentRoomData || startRoom || null;
        const base = await generateDefaultClassification($, inheritFrom, false);
        r.classification = { ...base };
      }
      ensureRoomFlagsConsistent(r);
      roomNameDatabasePlain[k] = r;
    }
    persistRoomDb(roomNameDatabasePlain);

    // Update Adjacent Rooms string (unchanged)
    const adjacentRoomsString = roomExitsArray
      .map(direction => {
        const roomData = roomNameDatabasePlain[coordKey] || {};
        const exitInfo = roomData.exits?.[direction] || { status: "open" };
        const targetCoordKey = exitInfo.targetCoordinates;
        const targetRoomName =
          roomNameDatabasePlain[targetCoordKey]?.name ||
          newAdjacentRooms[direction] ||
          (targetCoordKey === "0,0,0" ? "Ruined Temple Entrance" : "Unnamed Room");
        return `${direction}: ${targetRoomName}${exitInfo.status !== "open" ? ` (${exitInfo.status})` : ""}`;
      })
      .join(', ');

    updatedGameConsole = updatedGameConsole.replace(/Adjacent Rooms: .*/, `Adjacent Rooms: ${adjacentRoomsString}`);
    console.log("Updated Adjacent Rooms:", adjacentRoomsString);

    await $.run($ => generateMonstersForRoomUsingGPT($, roomName, roomDescription));

    // Boss Room Entry Logic (unchanged console behavior)
    const bossRoomCoordinatesMatch = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    if (bossRoomCoordinatesMatch) {
      const bossRoomCoordinates = {
        x: parseInt(bossRoomCoordinatesMatch[1]),
        y: parseInt(bossRoomCoordinatesMatch[2]),
        z: parseInt(bossRoomCoordinatesMatch[3])
      };
      console.log("Extracted Boss Room Coordinates:", bossRoomCoordinates);

      const currentCoordinatesMatch2 = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
      if (currentCoordinatesMatch2) {
        const currentCoordinates2 = {
          x: parseInt(currentCoordinatesMatch2[1]),
          y: parseInt(currentCoordinatesMatch2[2]),
          z: parseInt(currentCoordinatesMatch2[3])
        };
        console.log("Extracted Current Room Coordinates:", currentCoordinates2);

        if (currentCoordinates2.x === bossRoomCoordinates.x && currentCoordinates2.y === bossRoomCoordinates.y && currentCoordinates2.z === bossRoomCoordinates.z) {
          console.log("Player has entered the boss room.");

          // Ensure DB boss room classification is non-empty too
          const bossKey = coordinatesToString(bossRoomCoordinates);
          await ensureRoomHasNonEmptyClassification(roomNameDatabasePlain, bossKey, currentRoomData || startRoom || null);
          // Palette will be applied when description exists (current room does now)
          if (roomDescription) await applyPaletteFromDescriptionToRoom(roomNameDatabasePlain, bossKey, roomDescription);
          persistRoomDb(roomNameDatabasePlain);

          const nextArtifactMatch2 = updatedGameConsole.match(/Next Artifact: ([^\n]+)/);
          if (nextArtifactMatch2) {
            let nextArtifact2 = nextArtifactMatch2[1].trim().toLowerCase();
            console.log("Next Artifact found:", nextArtifact2);
            let artifactObject = { name: nextArtifact2, type: await determineArtifactType($, nextArtifact2) };
            const artifactModifiers = await generateObjectModifiers($, artifactObject);
            const updatedArtifactObject = { ...artifactObject, ...artifactModifiers };

            let objectsInRoomArray = objectsInRoom ? objectsInRoom.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) : [];
            if (objectsInRoomArray[0] === "none") objectsInRoomArray = [];
            objectsInRoomArray.push(nextArtifact2);

            updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${objectsInRoomArray.join(', ')}`);

            let objectsInRoomPropertiesMatch = updatedGameConsole.match(/Objects in Room Properties: ([^\n]+)/);
            let objectsInRoomPropertiesArray =
              objectsInRoomPropertiesMatch && objectsInRoomPropertiesMatch[1].trim().toLowerCase() !== "none"
                ? objectsInRoomPropertiesMatch[1].split('}, {').map(obj => `{${obj.replace(/^{|}$/g, '')}}`)
                : [];

            const artifactString = `{name: "${updatedArtifactObject.name}", type: "${updatedArtifactObject.type}", attack_modifier: ${updatedArtifactObject.attack_modifier}, damage_modifier: ${updatedArtifactObject.damage_modifier}, ac: ${updatedArtifactObject.ac}, magic: ${updatedArtifactObject.magic}}`;
            objectsInRoomPropertiesArray.push(artifactString);

            updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${objectsInRoomPropertiesArray.join(', ')}`);
            console.log("Updated game console after adding artifact:", updatedGameConsole);
          } else {
            console.log("No artifact to add.");
          }

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

    // Puzzle Generation Logic (unchanged prompts)
    const shouldGeneratePuzzle = Math.random() < 1.0;

    // ---- quest context (safe) ----
    function safeString(v, fallback = "None") {
      if (v == null) return fallback;
      try { return (typeof v === "string") ? v : JSON.stringify(v); } catch { return fallback; }
    }
    function getActiveTaskStringFromState() {
      try {
        const tasks = sharedState.getCurrentTasks ? (sharedState.getCurrentTasks() || []) : [];
        const idx   = sharedState.getCurrentTaskIndex ? (sharedState.getCurrentTaskIndex() || 0) : 0;
        const task  = (idx >= 0 && idx < tasks.length) ? tasks[idx] : null;
        return safeString(task, "None");
      } catch { return "None"; }
    }
    function getQuestUpdateStringFromState() {
      try {
        const s = sharedState.getLastQuestUpdate ? sharedState.getLastQuestUpdate() : "";
        return (s && String(s).trim()) ? String(s) : "None";
      } catch { return "None"; }
    }

    const activeTaskStr = getActiveTaskStringFromState();
    const questUpdateStr = getQuestUpdateStringFromState();

    if (shouldGeneratePuzzle) {
      console.log("Generating puzzle for the room.");
      $.model = "gpt-4.1-mini";
      $.temperature = 1.0;
      $.user`This is the ${roomName}'s exits: ${roomExits}. And here are the current objects in the room: ${objectsInRoom}. And here are the current monsters in the room: ${monstersInRoom} who are ${monstersState}. Store its contents and await the next prompt.`;
      $.user`This is the current quest: ${currentQuest} and here is the current quest's task: ${activeTaskStr} and the latest quest update: ${questUpdateStr}. Store this information and await the next prompt.`;
      $.user`FYI: For puzzle, tie to variability seed—vary type (e.g., ${diversitySeed}). Limit to 1 para; subvert history motif. Await.`;

      await $.assistant`Generate a detailed description of the room's environment and architecture for ${roomName}, weaving in elements of its ecology (e.g., flora, fauna, natural processes), economy (e.g., remnants of trade, resources, societal structures), and archaeology (e.g., ancient ruins, historical artifacts tied to the underworld's lore). Ensure this fits seamlessly with the existing room description, enhancing the narrative flow as the characters explore to advance the current quest and ultimately reclaim the Sepulchra to restore balance to the underworld. Only reference existing NPCs or monsters from the game console, describing any ongoing events, interactions (without dialogue), puzzles, riddles, or obstacles—but do not generate new characters, portable objects, or conversations. Include subtle, built-in hints about underlying events or mysteries (e.g., faint echoes suggesting forgotten rituals), but never reveal solutions. Make the description strange, unusual, and thought-provoking by drawing from surreal inspirations like infinite labyrinths or psychological distortions, varying themes to differentiate this room (e.g., if previous rooms were desolate, make this one vibrant yet corrupted). Incorporate multi-sensory details (sights, sounds, smells, textures) for immersion, and tailor the situation to the player and characters' context, such as information-gathering via clues, research through inscriptions, geographical navigation challenges, resource management dilemmas, logic puzzles, cryptographic symbols, or opportunities for exploiting/persuading existing monsters/NPCs. Output as a single, flowing paragraph with no line breaks, avoiding the word "you" and focusing on third-person narrative that advances the story's tension. STYLE — Storybook:- Occasionally adopt a fairy-tale / story lilt with light rhyme and meter. - Keep crystal clarity for actions/adjudication. Do NOT rhyme rules, coordinates, inventory, or outcomes like damage/XP. - Do not alter proper nouns, item names, stats, exits, or coordinates; never obscure actionable info with rhyme. - Cap lilt/rhymes: Use in 1 element only if seed fits (e.g., 'moral_inversion' → twisted rhyme; skip for auditory). - If apt, echo a regional refrain once in a while (not every turn). - Dilemma cap: 1 moral hook per puzzle (e.g., 'does truth bind or free?'—vary phrasing, no 'reclamation' echoes).`;
      const puzzleDescriptionResponse = await $.assistant.generation();
      puzzleInRoom = puzzleDescriptionResponse.content.trim();
      environmentDescription = puzzleInRoom;

      await $.user`Suggest exhaustion limit (2-6) for ${roomName} based on description complexity, lore, and features: ${puzzleInRoom}. Respond JSON: {"exhaustionLimit": int}.`;
      const limitResp = await $.assistant.generation();
      let limitParsed;
      try {
        limitParsed = JSON.parse(limitResp.content || "{}");
      } catch (error) {
        console.error("Failed to parse exhaustion limit JSON:", error);
        limitParsed = {};
      }
      const exhaustionLimit = limitParsed.exhaustionLimit || 4;
      currentRoomData.exhaustionLimit = exhaustionLimit;
      currentRoomData.attemptedSearches = 0;
      currentRoomData.trapTriggered = currentRoomData.trapTriggered ?? false;
      roomNameDatabasePlain[coordKey] = currentRoomData;

      // IMPORTANT CHANGE:
      // Do NOT re-classify shape here.
      // If we have description, apply colors-only from description (again) to ensure palette exists.
      if (roomDescription) {
        await applyPaletteFromDescriptionToRoom(roomNameDatabasePlain, coordKey, roomDescription);
        persistRoomDb(roomNameDatabasePlain);
      }

      $.model = "gpt-4.1-mini";
      $.temperature = 1.2;
      await $.assistant`Generate a puzzle or non-combat challenge (e.g., riddle, mechanical obstacle, social persuasion, environmental hazard, logic dilemma, cryptographic clue, or resource management task) and its solution for the room named ${roomName}, ensuring it draws directly from the room's environment, architecture, ecology, economy, or archaeology. Make the challenge strange, unusual, and thought-provoking by incorporating surreal or lore-inspired twists (e.g., echoing the underworld's imbalance or Mortacia's fading judgment), varying types to differentiate from previous rooms in the conversation history (e.g., if past puzzles were symbol-based, opt for persuasion or multi-step exploration). Keep it challenging yet resolvable with clear, engaging logic; the resolution should be satisfying, logical, somewhat simple, and tied to player actions like using carried items, conversing or persuading existing monsters/NPCs, or speaking specific words/phrases—include subtle hints in the description but never reveal the solution outright. Infuse multi-sensory details and narrative hooks for immersion, advancing the current quest toward reclaiming the Sepulchra while building tension through potential consequences or lore revelations upon resolution. Output in a single paragraph with no line breaks, avoiding the word "you," formatted as a description integrating the challenge into the room's narrative and clear steps for resolution. STYLE — Storybook:- Occasionally adopt a fairy-tale / story lilt with light rhyme and meter. - Keep crystal clarity for actions/adjudication. Do NOT rhyme rules, coordinates, inventory, or outcomes like damage/XP. - Do not alter proper nouns, item names, stats, exits, or coordinates; never obscure actionable info with rhyme. - Cap lilt/rhymes: Use in 1 element only if seed fits (e.g., 'moral_inversion' → twisted rhyme; skip for auditory). - If apt, echo a regional refrain once in a while (not every turn).`;
      const puzzleSolutionResponse = await $.assistant.generation();
      puzzleSolution = puzzleSolutionResponse.content.trim();

      if (puzzleInRoom && puzzleSolution) {
        console.log("Generated Puzzle:", puzzleInRoom);
        console.log("Puzzle Solution:", puzzleSolution);
        updatedGameConsole = updatedGameConsole.replace(/Puzzle in Room: .*/, `Puzzle in Room: ${puzzleInRoom}`);
        updatedGameConsole = updatedGameConsole.replace(/Puzzle Solution: .*/, `Puzzle Solution: ${puzzleSolution}`);
      } else {
        console.log("Failed to generate puzzle description or solution.");
      }
    } else {
      console.log("No puzzle generated for this room.");
      updatedGameConsole = updatedGameConsole.replace(/Puzzle in Room: .*/, `Puzzle in Room: None`);
      updatedGameConsole = updatedGameConsole.replace(/Puzzle Solution: .*/, `Puzzle Solution: None`);
    }

    needsUpdate = true;
  }

  if (needsUpdate) {
    console.log("Updated Game Console:", updatedGameConsole);
    sharedState.setUpdatedGameConsole(updatedGameConsole);
    return roomDescriptionGenerated;
  }

  return roomDescriptionGenerated;
}

// Ensure a room record exists and has the right shape.
function canonicalKey(k) {
  return normalizeCoordKey(k);
}

function canonicalizeRoomDb(db) {
  const fixed = {};
  const asObj = (v) => (v && typeof v === "object") ? v : {};

  // Prefer "richer" values when merging duplicates.
  const pick = (a, b) => (a !== undefined && a !== null && a !== "" ? a : b);

  for (const [rawK, rawV] of Object.entries(db || {})) {
    const ck = canonicalKey(rawK);
    const prev = asObj(fixed[ck]);
    const v = asObj(rawV);

    // Deep-ish merge critical nested structures without losing fields.
    const merged = {
      ...prev,
      ...v,

      // exits: merge by direction (don’t drop existing subfields)
      exits: (() => {
        const out = { ...(prev.exits || {}) };
        for (const [dir, ex] of Object.entries(v.exits || {})) {
          const prior = out[dir] && typeof out[dir] === "object" ? out[dir] : {};
          out[dir] = (ex && typeof ex === "object") ? { ...prior, ...ex } : ex;
        }
        return out;
      })(),

      // objects: keep arrays; if both exist, concatenate (your later de-dupe/prune can clean)
      objects: (() => {
        const a = Array.isArray(prev.objects) ? prev.objects : [];
        const b = Array.isArray(v.objects) ? v.objects : [];
        return b.length ? (a.length ? a.concat(b) : b) : a;
      })(),

      // monsters: merge objects
      monsters: {
        ...(prev.monsters || { inRoom: "None", equippedProperties: "None", state: "None" }),
        ...(v.monsters || {})
      },

      // classification: merge objects (don’t drop colors/biome/etc)
      classification: {
        ...(prev.classification || {}),
        ...(v.classification || {})
      }
    };

    // Preserve core scalars carefully
    merged.name = pick(v.name, prev.name);
    merged.exhaustionLimit = pick(v.exhaustionLimit, prev.exhaustionLimit);
    merged.attemptedSearches = pick(v.attemptedSearches, prev.attemptedSearches) ?? 0;
    merged.trapTriggered = pick(v.trapTriggered, prev.trapTriggered) ?? false;

    // Normalize indoor/isIndoor/isOutdoor from best available source
    const classIndoor = (typeof merged.classification?.indoor === "boolean") ? merged.classification.indoor : undefined;
    const indoor = (typeof merged.indoor === "boolean") ? merged.indoor
                : (typeof merged.isIndoor === "boolean") ? merged.isIndoor
                : classIndoor;

    if (typeof indoor === "boolean") {
      merged.indoor = indoor;
      merged.isIndoor = indoor;
      merged.isOutdoor = !indoor;
    }

    fixed[ck] = merged;
  }

  return fixed;
}

// ---- NEW: de-dupe + prune objects so keys don't re-spawn on re-entry ----
function canonicalObjectSignature(o) {
  return `${(o?.type||'other').toLowerCase()}::${(o?.name||'').trim().toLowerCase()}`;
}

async function pruneAndDedupeRoomObjectsOnEntry($, coordKey, roomNameDatabasePlain, updatedGameConsole) {
  const room = roomNameDatabasePlain[coordKey];
  if (!room) return;

  // Parse inventory from console
  const inv = (() => {
    try {
      const m = updatedGameConsole.match(/^Inventory:\s*(.*)$/mi);
      if (!m) return [];
      const line = (m[1] || '').trim();
      if (!line || /^none$/i.test(line)) return [];
      return line.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    } catch { return []; }
  })();
  const invSet = new Set(inv);

  const seen = new Set();
  const nextObjects = [];
  let changed = false;

  for (let o of (room.objects || [])) {
    if (!o || !o.name) { changed = true; continue; }

    // Treat keys as "consumed" if player has them OR the exit they unlock is already open
    const inInventory = invSet.has(String(o.name).toLowerCase());
    const unlockedExitOpen = (o.type === 'key' && o.unlocks && o.unlocks.coordinates && o.unlocks.direction)
      ? (function isExitOpen(coordsKey, direction) {
          const ex = roomNameDatabasePlain?.[coordsKey]?.exits?.[direction];
          return !!ex && String(ex.status || '').toLowerCase() === 'open';
        })(o.unlocks.coordinates, o.unlocks.direction)
      : false;

    const isTakenFlag = (o.taken === true || o.removed === true || o.consumed === true);

    if (inInventory || unlockedExitOpen || isTakenFlag) {
      // Mark and drop from current room so it won't reappear
      o.taken = true;
      changed = true;
      continue;
    }

    // Ensure modifiers exist so quest objects don't show zeros
    if (!o.properties || ((o.properties.attack ?? 0) === 0
      && (o.properties.damage ?? 0) === 0
      && (o.properties.ac ?? 0) === 0
      && (o.properties.magic ?? 0) === 0)) {
      o = await (async () => {
        try {
          const mods = await generateObjectModifiers($, { name: o.name, type: o.type || 'other' });
          return {
            ...o,
            properties: {
              attack: mods.attack_modifier || 0,
              damage: mods.damage_modifier || 0,
              ac:     mods.ac || 0,
              magic:  mods.magic || 0,
            }
          };
        } catch { return o; }
      })();
      changed = true;
    }

    // De-dupe (same name+type in the same room)
    const sig = canonicalObjectSignature(o);
    if (seen.has(sig)) { changed = true; continue; }
    seen.add(sig);

    nextObjects.push(o);
  }

  if (changed) {
    room.objects = nextObjects;
    roomNameDatabasePlain[coordKey] = room;
    sharedState.setRoomNameDatabase(JSON.stringify(roomNameDatabasePlain));
  }
}

// --- ROOM ENSURER (preserves everything) ---
function ensureRoom(db, key, defaults = {}) {
  const ck = canonicalKey(key);
  const r = (db[ck] && typeof db[ck] === "object") ? db[ck] : {};

  // Only fill missing defaults; never rebuild/strip.
  db[ck] = { ...r };

  for (const [k, v] of Object.entries(defaults || {})) {
    if (db[ck][k] === undefined || db[ck][k] === null || db[ck][k] === "") {
      db[ck][k] = v;
    }
  }

  if (db[ck].exits == null || typeof db[ck].exits !== "object") db[ck].exits = {};
  if (!Array.isArray(db[ck].objects)) db[ck].objects = [];
  if (db[ck].monsters == null || typeof db[ck].monsters !== "object") {
    db[ck].monsters = { inRoom: "None", equippedProperties: "None", state: "None" };
  }

  // Keep indoor flags consistent if we can
  if (typeof db[ck].classification?.indoor === "boolean" && typeof db[ck].indoor !== "boolean") {
    db[ck].indoor = db[ck].classification.indoor;
  }
  if (typeof db[ck].indoor === "boolean") {
    db[ck].isIndoor = db[ck].indoor;
    db[ck].isOutdoor = !db[ck].indoor;
  }

  return db[ck];
}


// Read a single-line value like "Next Boss: X" from the console text.
function readLine(consoleText, label) {
  const m = consoleText.match(new RegExp(`${label}:\\s*([^\\n]+)`));
  return (m && m[1]) ? m[1].trim() : null;
}

// Parse the "Monsters in Room" section into names/state/equipped, and keep a consoleBlock.
function parseMonstersFromConsole(consoleText) {
  const out = { names: [], state: 'None', equipped: 'None', consoleBlock: '' };

  const start = consoleText.indexOf('Monsters in Room:');
  if (start === -1) return out;

  const rest = consoleText.slice(start);
  const nextMarkers = [
    rest.indexOf('Monsters Equipped Properties:'),
    rest.indexOf('Monsters State:'),
    rest.indexOf('Rooms Visited:')
  ].filter(i => i >= 0);
  const end = nextMarkers.length ? Math.min(...nextMarkers) : rest.length;
  const block = rest.slice(0, end);
  out.consoleBlock = block.trim();

  const lines = block.split('\n').map(s => s.trim());
  // After the "Monsters in Room:" header, grab subsequent non-empty, non-attribute lines as names.
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i];
    if (!L) continue;
    if (L.startsWith('Monsters')) break;
    if (!/^(Level|AC|XP|HP|MaxHP|Equipped|Attack|Damage|Armor|Magic):/i.test(L)) {
      out.names.push(L);
    }
  }

  const stateM = consoleText.match(/Monsters State:\s*([^\n]+)/);
  if (stateM) out.state = stateM[1].trim();

  const eqM = consoleText.match(/Monsters Equipped Properties:\s*([^\n]+)/);
  if (eqM) out.equipped = eqM[1].trim();

  return out;
}

// Write monsters (names + equipped + state + consoleBlock) into the DB for a given room key.
// Returns the normalized monsters object that was written.
function writeMonstersDbFromConsole(roomKey, consoleText, db) {
  ensureRoom(db, roomKey);

  const parsed = parseMonstersFromConsole(consoleText);
  const equipped = (consoleText.match(/Monsters Equipped Properties:\s*([^\n]+)/)?.[1] || 'None').trim();
  const state = (consoleText.match(/Monsters State:\s*([^\n]+)/)?.[1] || 'None').trim();

  db[roomKey].monsters = {
    inRoom: parsed.names.length ? parsed.names.join(', ') : 'None',
    equippedProperties: equipped || 'None',
    state: state || 'None',
    consoleBlock: parsed.consoleBlock || ''
  };
  return db[roomKey].monsters;
}
// ===== end helpers =====

async function seedAndManageQuest($, updatedGameConsole, userInput) {
  const currentQuest = sharedState.getCurrentQuest();
  if (!currentQuest) return { questJustSeeded: false, questUpdate: '', activeTask: null };
  // ---------- small utils ----------
  function parseOnlyJson(text, fallback) {
    let t = (text || "").trim();
    if (t.startsWith("```json")) t = t.slice(7);
    if (t.endsWith("```")) t = t.slice(0, -3);
    t = t.trim();
    try { return JSON.parse(t); } catch { return fallback; }
  }
  const titleCase = (s = "") => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const isZeroProps = (p) => !p || (
    (p.attack ?? 0) === 0 &&
    (p.damage ?? 0) === 0 &&
    (p.ac ?? 0) === 0 &&
    (p.magic ?? 0) === 0
  );
  async function ensureObjectHasModifiers($, obj) {
    if (!obj) return obj;
    obj.type = obj.type || 'other';
    obj.properties = obj.properties || {};
    if (isZeroProps(obj.properties)) {
      const mods = await generateObjectModifiers($, { name: obj.name, type: obj.type });
      obj.properties = {
        attack: mods.attack_modifier || 0,
        damage: mods.damage_modifier || 0,
        ac: mods.ac || 0,
        magic: mods.magic || 0
      };
    }
    return obj;
  }
  function toDbObject(raw, overrideType) {
    const name = (raw && raw.name) || 'Unknown';
    const type = overrideType || (raw && raw.type) || 'other';
    const attack = raw?.attack ?? raw?.attack_modifier ?? raw?.properties?.attack ?? 0;
    const damage = raw?.damage ?? raw?.damage_modifier ?? raw?.properties?.damage ?? 0;
    const ac = raw?.ac ?? raw?.properties?.ac ?? 0;
    const magic = raw?.magic ?? raw?.properties?.magic ?? 0;
    const base = { name, type, properties: { attack, damage, ac, magic } };
    if (type === 'key' && raw && raw.unlocks) base.unlocks = raw.unlocks;
    return base;
  }
  function updateCurrentRoomObjectsInConsole(consoleText, objectsArr = []) {
    try {
      const names = objectsArr.map(o => (typeof o === 'string' ? o : o?.name || 'Unknown')).filter(Boolean);
      const propsList = objectsArr.map(o => {
        if (typeof o === 'string') return o;
        const { name = 'Unknown', type = 'other', properties = {} } = o || {};
        const { attack = 0, damage = 0, ac = 0, magic = 0 } = properties;
        return `{name: "${name}", type: "${type}", attack_modifier: ${attack}, damage_modifier: ${damage}, ac: ${ac}, magic: ${magic}}`;
      });
      const objectsLine = `Objects in Room: ${names.length ? names.join(', ') : 'None'}`;
      const propsLine = `Objects in Room Properties: ${propsList.length ? propsList.join(', ') : 'None'}`;
      if (/^Objects in Room: .*/m.test(consoleText)) {
        consoleText = consoleText.replace(/^Objects in Room: .*/m, objectsLine);
      } else {
        consoleText = (consoleText + '\n' + objectsLine).trim();
      }
      if (/^Objects in Room Properties: .*/m.test(consoleText)) {
        consoleText = consoleText.replace(/^Objects in Room Properties: .*/m, propsLine);
      } else {
        consoleText = (consoleText + '\n' + propsLine).trim();
      }
      return consoleText;
    } catch { return consoleText; }
  }
  // --- NEW: get NPC names in party (to exclude from monsters) ---
  function getNpcPartyNames(consoleText) {
    const block = consoleText.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited|Objects in Room|Exits|$))/)?.[1] || '';
    const re = /^([^,\n]+)\s*,/gm;
    const out = [];
    let m;
    while ((m = re.exec(block)) !== null) {
      const nm = (m[1] || '').trim();
      if (nm && !/^none$/i.test(nm)) out.push(nm);
    }
    return [...new Set(out)];
  }
  // Prefer full monster generator if available, else fallback — now with exclude list baked into GPT fallback
  async function generateMonstersConsoleBlock($, placement, roomMeta, excludeNames = []) {
    try {
      if (typeof generateMonstersForRoom === 'function') {
        // If your implementation supports an options param, you can pass { excludeNames } there.
        const txt = await generateMonstersForRoom($, roomMeta?.name || 'Room', roomMeta?.desc || 'A room', placement);
        if (txt) return txt;
      }
    } catch (e) { console.warn('[seed] generateMonstersForRoom failed, falling back', e); }
    try {
      if (typeof generateMonsters === 'function') {
        const txt = await generateMonsters($, roomMeta?.name || 'Room', roomMeta?.desc || 'A room', placement);
        if (txt) return txt;
      }
    } catch (e) { console.warn('[seed] generateMonsters failed, falling back', e); }
    try {
      // Stuff the exclude guidance into the desc for the GPT-based generator
      const desc = `${roomMeta?.desc || 'A room'}\n\nIMPORTANT: Do NOT use these NPC names as monsters (they are allies in party): ${excludeNames.join(', ') || '(none)'}.`;
      const shadow = await generateMonstersForRoomUsingGPT($, roomMeta?.name || "Room", desc, placement);
      return (typeof shadow === 'string') ? shadow : (sharedState.getUpdatedGameConsole?.() || '');
    } catch (e) {
      console.warn('[seed] ultimate fallback: empty monsters block', e);
      return 'Monsters in Room: None';
    }
  }
  // ---------- console & DB ----------
  let consoleText = (typeof updatedGameConsole === 'string' ? updatedGameConsole : '') || '';
  if (!consoleText) { try { consoleText = sharedState.getUpdatedGameConsole() || ''; } catch {} }
  updatedGameConsole = consoleText;
  let roomNameDatabasePlain;
  try { roomNameDatabasePlain = JSON.parse(sharedState.getRoomNameDatabase() || "{}"); }
  catch { roomNameDatabasePlain = {}; }
  // Canonicalize once per turn to merge rogue keys
  roomNameDatabasePlain = canonicalizeRoomDb(roomNameDatabasePlain);
  // Ensure the start room never loses its name
  ensureRoom(roomNameDatabasePlain, "0,0,0", { name: "Ruined Temple Entrance" });
  const coordMatch = consoleText.match(/Coordinates: X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
  const currentCoords = coordMatch
    ? { x: parseInt(coordMatch[1]), y: parseInt(coordMatch[2]), z: parseInt(coordMatch[3]) }
    : { x: 0, y: 0, z: 0 };
  const currentRoomKey = `${currentCoords.x},${currentCoords.y},${currentCoords.z}`;
  // After ensureRoom(...) + setRoomNameDatabase(...), compute currentRoomKey
  ensureRoom(roomNameDatabasePlain, currentRoomKey);
  sharedState.setRoomNameDatabase(JSON.stringify(roomNameDatabasePlain));
  // NEW: prune keys/objects so taken ones never reappear
  await pruneAndDedupeRoomObjectsOnEntry($, currentRoomKey, roomNameDatabasePlain, updatedGameConsole);
  // Then do your syncs (they now read the cleaned DB and won't re-add taken keys)
  updatedGameConsole = await syncObjectsOnRoomEntry($, currentCoords, roomNameDatabasePlain, updatedGameConsole);
  updatedGameConsole = await syncKeysOnRoomEntry($, currentCoords, roomNameDatabasePlain, updatedGameConsole);
  updatedGameConsole = await syncMonstersOnRoomEntry($, currentCoords, roomNameDatabasePlain, updatedGameConsole);
  sharedState.setUpdatedGameConsole(updatedGameConsole);
  let currentTasks = sharedState.getCurrentTasks() || [];
  let currentTaskIndex = sharedState.getCurrentTaskIndex() || 0;
  const allCoords = Object.keys(roomNameDatabasePlain);
  if (!allCoords.includes(currentRoomKey)) allCoords.push(currentRoomKey);
  const coordsExceptCurrent = allCoords.filter(c => c !== currentRoomKey);
  // Get monsters in current room
  function readLine(consoleText, key) {
    const re = new RegExp(`^${key}:\\s*(.*)$`, 'mi');
    const m = re.exec(consoleText);
    return m ? m[1].trim() : null;
  }
  const monstersInRoom = readLine(updatedGameConsole, "Monsters in Room") || "None";
  const monsterNames = monstersInRoom !== "None" ? monstersInRoom.split(", ").map(s => s.trim()) : [];
  const hasMonstersInCurrent = monsterNames.length > 0;
  // ---------- req builders & checkers ----------
  function buildHardRequirements(taskType, elements) {
    const t = (taskType || '').toLowerCase();
    const findFirst = (predicate) => elements.find(predicate);
    const firstObj = findFirst(e => e && e.type && e.type !== 'monster');
    const firstKey = findFirst(e => e && e.type === 'key');
    const firstMon = findFirst(e => e && e.type === 'monster');
    const reqs = [];
    if (t === 'fetch') {
      if (firstObj) {
        reqs.push({ check: 'at_coords', value: firstObj.placement });
        reqs.push({ check: 'inventory_contains', value: firstObj.name });
      }
    } else if (t === 'defeat') {
      if (firstMon) {
        reqs.push({ check: 'at_coords', value: firstMon.placement });
        reqs.push({ check: 'monster_hp_zero', value: firstMon.name });
      }
    } else if (t === 'deliver') {
      const dest = (elements.length > 1 ? elements[elements.length - 1].placement : (firstObj?.placement || currentRoomKey));
      if (firstObj) reqs.push({ check: 'inventory_contains', value: firstObj.name });
      if (dest) reqs.push({ check: 'at_coords', value: dest });
    } else {
      if (firstObj) reqs.push({ check: 'at_coords', value: firstObj.placement });
      else if (firstMon) reqs.push({ check: 'at_coords', value: firstMon.placement });
      if (firstKey) reqs.push({ check: 'inventory_contains', value: firstKey.name });
    }
    return reqs;
  }
  function buildActionRequirements(taskType, elements) {
    const t = (taskType || '').toLowerCase();
    const reqs = [];
    for (const el of elements) {
      if (el?.type === 'key' && el.unlocks) {
        const u = el.unlocks;
        if (u.coordinates && u.direction) {
          reqs.push({ check: 'exit_open', coords: u.coordinates, direction: u.direction });
        }
      }
    }
    if (t === 'defeat') {
      const mon = elements.find(e => e.type === 'monster');
      if (mon) reqs.push({ check: 'monster_hp_zero', value: mon.name });
    }
    return reqs;
  }
  function parseInventoryFromConsole(text) {
    try {
      const m = text.match(/^Inventory:\s*(.*)$/mi);
      if (!m) return [];
      const line = (m[1] || '').trim();
      if (!line || /^none$/i.test(line)) return [];
      return line.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    } catch { return []; }
  }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Parse HP looking specifically inside the latest "Monsters in Room:" section.
// Falls back to a proximity search anywhere in the text.
function parseMonsterHpFromText(text, monsterName) {
  if (!text || !monsterName) return null;
  // Use the last visible monsters section (current state after combat)
  const parts = text.split(/Monsters in Room:/i);
  const block = parts.length > 1 ? parts[parts.length - 1] : text;
  // 1) Try: name line followed by a nearby "HP: N" inside the block
  // - Allow titles after the name (e.g., "Thalzirax, the Sandwraith Viper")
  // - Be robust to "Thalzirax's" by matching name as a token
  const re1 = new RegExp(
    `^\\s*(?:${escapeRe(monsterName)}\\b[^\\n]*?)\\n[\\s\\S]{0,200}?^\\s*HP:\\s*(-?\\d+)\\b`,
    'im'
  );
  let m = re1.exec(block);
  if (m) return parseInt(m[1], 10);
  // 2) Fallback: global proximity search anywhere
  const re2 = new RegExp(`${escapeRe(monsterName)}[\\s\\S]{0,200}?HP:\\s*(-?\\d+)\\b`, 'i');
  m = re2.exec(text);
  return m ? parseInt(m[1], 10) : null;
}
// NEW: prefer up-to-date console first, then fall back to DB snapshot
function getMonsterHpFromDbOrConsole(monsterName, placementKey) {
  // 1) Live console (most accurate during/after combat)
  const hpLive = parseMonsterHpFromText(updatedGameConsole, monsterName);
  if (typeof hpLive === 'number') return hpLive;
  // 2) Fallback to DB consoleBlock (seed snapshot)
  try {
    const cb = roomNameDatabasePlain?.[placementKey]?.monsters?.consoleBlock;
    if (cb) {
      const hpDb = parseMonsterHpFromText(cb, monsterName);
      if (typeof hpDb === 'number') return hpDb;
    }
  } catch {}
  return null;
}
  function isExitOpen(coordsKey, direction) {
    const ex = roomNameDatabasePlain?.[coordsKey]?.exits?.[direction];
    return !!ex && String(ex.status || '').toLowerCase() === 'open';
  }
  function gateWithRequirements(task, consoleText) {
    const hardFails = [];
    const actionFails = [];
    const inv = parseInventoryFromConsole(consoleText);
    const invSet = new Set(inv.map(s => s.toLowerCase()));
    const hard = Array.isArray(task.hardRequirements) ? task.hardRequirements : [];
    const act = Array.isArray(task.actionRequirements) ? task.actionRequirements : [];
    for (const r of hard) {
      if (!r || !r.check) continue;
      const check = String(r.check).toLowerCase();
      if (check === 'at_coords') {
        const need = String(r.value || '').trim();
        if (currentRoomKey !== need) hardFails.push(`Be at ${need}`);
      } else if (check === 'inventory_contains') {
        const item = (r.value || '').toString().toLowerCase();
        if (!invSet.has(item)) hardFails.push(`Have "${r.value}" in Inventory`);
      } else if (check === 'monster_hp_zero') {
        const mon = (r.value || '').toString();
        const placementHint = (task.requiredElements || []).find(e => e.type === 'monster' && e.name === mon)?.placement;
        const hp = getMonsterHpFromDbOrConsole(mon, placementHint || currentRoomKey);
        if (!(typeof hp === 'number' && hp <= 0)) hardFails.push(`${mon} HP must be 0`);
      }
    }
    for (const r of act) {
      if (!r || !r.check) continue;
      const check = String(r.check).toLowerCase();
      if (check === 'exit_open') {
        const ok = isExitOpen(r.coords, r.direction);
        if (!ok) actionFails.push(`Open the ${r.direction} exit at ${r.coords}`);
      } else if (check === 'monster_hp_zero') {
        const mon = (r.value || '').toString();
        const placementHint = (task.requiredElements || []).find(e => e.type === 'monster' && e.name === mon)?.placement;
        const hp = getMonsterHpFromDbOrConsole(mon, placementHint || currentRoomKey);
        if (!(typeof hp === 'number' && hp <= 0)) actionFails.push(`${mon} HP must be 0`);
      }
    }
    return { hardFails, actionFails };
  }
  // Ensure DB.monsters has names-only inRoom and the full text in consoleBlock — with exclusion support
function normalizeMonstersDbEntry(db, placementKey, excludeSet) {
  const room = db[placementKey] || (db[placementKey] = {});
  const mon = room.monsters || (room.monsters = { inRoom: "None", equippedProperties: "None", state: "None" });
  const block = String(mon.consoleBlock || "");
  let names = [];
  if (block) {
    // Primary: match chunks where a line (name) is followed by a sex line
    // and is NOT the header or a stat label.
    const re = /^(?!Monsters in Room:)([^\n:][^\n]*)\n[\\s\\S]{0,200}?\\s*(Male|Female|Unknown)\b/gmi;
    let m;
    while ((m = re.exec(block)) !== null) {
      const nm = (m[1] || "").trim();
      if (nm) names.push(nm);
    }
    // Fallback: pick first non-empty, non-label line after the header
    if (!names.length) {
      const labelRE = /^(Monsters in Room|Monsters Equipped Properties|Monsters State|Male|Female|Unknown|Level|AC|XP|HP|MaxHP|Equipped|Attack|Damage|Armor|Magic)\b/i;
      for (const line of block.split(/\n+/)) {
        const t = line.trim();
        if (!t || labelRE.test(t)) continue;
        names.push(t);
        break;
      }
    }
  }
  if (excludeSet && excludeSet.size) {
    names = names.filter(n => !excludeSet.has(n.toLowerCase()));
  }
  mon.inRoom = names.length ? names.join(", ") : "None";
  mon.state = mon.state || (block ? "Neutral" : "None");
  room.monsters = { ...mon, consoleBlock: block };
}
  // Get a robust first monster name for a placement, skipping excluded names
    function getFirstMonsterNameForPlacement(db, placementKey, fallbackBlock, excludeSet) {
      const inRoomStr = String(db?.[placementKey]?.monsters?.inRoom || "");
      let pool = inRoomStr.split(/,\s*/).map(s => s.trim()).filter(Boolean);
      if (excludeSet?.size) pool = pool.filter(n => !excludeSet.has(n.toLowerCase()));
   
      // Avoid picking the header or stat labels
      const bad = /^(Monsters in Room:|Male|Female|Unknown|Level|AC|XP|HP|MaxHP|Equipped|Attack|Damage|Armor|Magic)\b/i;
      let first = pool.find(n => !bad.test(n)) || "";
   
      if (!first) {
        const block = String(fallbackBlock || db?.[placementKey]?.monsters?.consoleBlock || "");
        const m = /^(?!Monsters in Room:)([^\n:][^\n]*)\n\\s*(Male|Female|Unknown)\b/im.exec(block);
        if (m) first = m[1].trim();
      }
      return first || "Unknown";
    }
  // ------------------- seeding helper (define task AFTER elements exist) -------------------
  const seedNextTaskForCurrentIndex = async () => {
    $.model = "gpt-4.1-mini";
    $.temperature = 1.0;
    // Stage 3 (boss) — unchanged
    if (currentTaskIndex === 2) {
      const bossName = readLine(updatedGameConsole, "Next Boss") || "The Boss";
      const bossRoom = readLine(updatedGameConsole, "Next Boss Room") || "Boss Chamber";
      const bossCoordsLine = readLine(updatedGameConsole, "Boss Room Coordinates") || "";
      const bossCoords = (bossCoordsLine && /X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/.test(bossCoordsLine))
        ? `${RegExp.$1},${RegExp.$2},${RegExp.$3}` : currentRoomKey;
      const nextArtifact = readLine(updatedGameConsole, "Next Artifact") || "the artifact";
      const newTask = {
        type: "Defeat",
        desc: `Navigate to ${bossRoom} at ${bossCoords}, defeat ${bossName}, and claim ${nextArtifact}.`,
        metrics: `Boss HP=0 and ${nextArtifact} in Inventory`,
        requiredElements: [{ type: 'monster', name: bossName, placement: bossCoords }],
        actionKind: "defeat_monster",
        hardRequirements: [
          { check: 'at_coords', value: bossCoords },
          { check: 'monster_hp_zero', value: bossName }
        ],
        actionRequirements: [
          { check: 'monster_hp_zero', value: bossName }
        ],
        status: "Pending",
      };
      currentTasks.push(newTask);
      sharedState.setCurrentTasks(currentTasks);
      sharedState.setCurrentTaskIndex(2);
      sharedState.setQuestSeeded(true);
      return newTask;
    }
    // 1) Decide how many elements are REQUIRED TO COMPLETE the step
    await $.user`How many required elements (0–3) are needed to COMPLETE the next quest step? These are world elements the player must use/defeat/deliver to finish the step (not just to begin it). Respond ONLY {"count": N} with N in {0,1,2,3}.`;
    const reqCountResp = await $.assistant.generation({
      parameters: { count: { type: Number, enum: [0, 1, 2, 3] } }
    });
    let countParsed = 0;
    try { countParsed = Number(parseOnlyJson(reqCountResp.content, { count: 0 }).count || 0); } catch {}
    const reqCount = Math.max(0, Math.min(3, isNaN(countParsed) ? 0 : countParsed));
    // 2) Create/place those elements first (DB is source of truth)
    const allCoords = Object.keys(roomNameDatabasePlain);
    if (!allCoords.includes(currentRoomKey)) allCoords.push(currentRoomKey);
    const coordsExceptCurrent = allCoords.filter(c => c !== currentRoomKey);
    const preferElsewhere = Math.random() < 0.8;
    const usedPlacements = new Set();
    const requiredElementsStrings = [];
    const partyNpcNames = getNpcPartyNames(updatedGameConsole);
    const npcExcludeSet = new Set(partyNpcNames.map(n => n.toLowerCase()));
    for (let i = 0; i < reqCount; i++) {
      await $.user`For required element ${i + 1} of ${reqCount}, provide ONLY {"type":"X"} where X ∈ {"object","key","monster"} (non-boss). NEVER pick party NPCs as monsters: ${partyNpcNames}. If monsters are in the current room (${monstersInRoom}), strongly prefer "monster" to incorporate them.`;
      const typeRespEl = await $.assistant.generation({
        parameters: { type: { type: String, enum: ["object", "key", "monster"] } }
      });
      const elType = (parseOnlyJson(typeRespEl.content, { type: "object" }).type || "object").toLowerCase();
      const enumList = (preferElsewhere && coordsExceptCurrent.length) ? coordsExceptCurrent : allCoords;
      await $.user`Pick the placement coordinates from this list: ${enumList.join(', ')}. If the element is a monster and there are monsters here, prefer the current room ${currentRoomKey}. Respond ONLY {"placement":"x,y,z"} using one of them.`;
      const placeRespEl = await $.assistant.generation({
        parameters: { placement: { type: String, enum: enumList } }
      });
      let placement = (parseOnlyJson(placeRespEl.content, { placement: currentRoomKey }).placement || currentRoomKey).trim();
      if (usedPlacements.has(placement)) {
        const alts = enumList.filter(c => !usedPlacements.has(c));
        if (alts.length) placement = alts[Math.floor(Math.random() * alts.length)];
      }
      usedPlacements.add(placement);
      const room = ensureRoom(roomNameDatabasePlain, placement);
      if (elType === 'object') {
        let objDb = (room.objects && room.objects.length) ? room.objects[0] : null;
        if (!objDb) {
          const objs = await generateRoomObjects($, room.name || 'Room', room.description || 'A room');
          if (objs && objs.length) {
            objDb = toDbObject(objs[0], objs[0]?.type);
            objDb = await ensureObjectHasModifiers($, objDb);
            room.objects.push(objDb);
          } else {
            objDb = await ensureObjectHasModifiers($, { name: "mysterious relic", type: "other", properties: {} });
            room.objects.push(objDb);
          }
        } else {
          objDb = await ensureObjectHasModifiers($, objDb);
        }
        if (placement === currentRoomKey) {
          updatedGameConsole = updateCurrentRoomObjectsInConsole(updatedGameConsole, room.objects);
        }
        requiredElementsStrings.push(`object|${objDb.name}|${placement}`);
      } else if (elType === 'key') {
        let keyDb = (room.objects || []).find(o => o.type === 'key');
        if (!keyDb) {
          const keyRaw = await generateKey($, currentCoords, "dir");
          keyDb = toDbObject({ ...keyRaw, type: 'key' }, 'key');
          keyDb = await ensureObjectHasModifiers($, keyDb);
          room.objects.push(keyDb);
        } else {
          keyDb = await ensureObjectHasModifiers($, keyDb);
        }
        if (placement === currentRoomKey) {
          updatedGameConsole = updateCurrentRoomObjectsInConsole(updatedGameConsole, room.objects);
        }
        requiredElementsStrings.push(`key|${keyDb.name}|${placement}`);
      } else if (elType === 'monster') {
        const hasMon = room.monsters && room.monsters.inRoom && room.monsters.inRoom !== 'None';
        let blockUsed = null;
        let firstName = "";
        if (placement === currentRoomKey && hasMonstersInCurrent) {
          // Use existing monster in current room
          firstName = getFirstMonsterNameForPlacement(roomNameDatabasePlain, placement, null, npcExcludeSet);
          if (!firstName || firstName === "Unknown" || npcExcludeSet.has(firstName.toLowerCase())) {
            // Fallback generate if needed, but prefer existing
            const meta = { name: room.name || 'Room', desc: room.description || 'A room' };
            blockUsed = await generateMonstersConsoleBlock($, placement, meta, partyNpcNames);
            writeMonstersDbFromConsole(placement, blockUsed, roomNameDatabasePlain);
            normalizeMonstersDbEntry(roomNameDatabasePlain, placement, npcExcludeSet);
            firstName = getFirstMonsterNameForPlacement(roomNameDatabasePlain, placement, blockUsed, npcExcludeSet);
          }
        } else {
          if (!hasMon) {
            const meta = { name: room.name || 'Room', desc: room.description || 'A room' };
            blockUsed = await generateMonstersConsoleBlock($, placement, meta, partyNpcNames);
            writeMonstersDbFromConsole(placement, blockUsed, roomNameDatabasePlain);
            normalizeMonstersDbEntry(roomNameDatabasePlain, placement, npcExcludeSet);
            if (placement === currentRoomKey) {
              updatedGameConsole = await syncMonstersOnRoomEntry($, currentCoords, roomNameDatabasePlain, updatedGameConsole);
            }
          } else {
            normalizeMonstersDbEntry(roomNameDatabasePlain, placement, npcExcludeSet);
            if (placement === currentRoomKey) {
              updatedGameConsole = await syncMonstersOnRoomEntry($, currentCoords, roomNameDatabasePlain, updatedGameConsole);
            }
          }
          firstName = getFirstMonsterNameForPlacement(roomNameDatabasePlain, placement, blockUsed, npcExcludeSet);
        }
        // As a last resort, ask GPT to provide a monster name NOT in the excluded set
        if (!firstName || firstName === "Unknown" || npcExcludeSet.has(firstName.toLowerCase())) {
          await $.user`Provide ONLY {"name":"X"} where X is a unique monster name appropriate for ${(room.name || 'the room')} that is NOT any of: ${partyNpcNames.join(', ') || '(none)'} and not a party member.`;
          const nresp = await $.assistant.generation({ parameters: { name: String } });
          firstName = (parseOnlyJson(nresp.content, { name: "shade revenant" }).name || "shade revenant").toString();
        }
        requiredElementsStrings.push(`monster|${firstName}|${placement}`);
      }
    }
    sharedState.setRoomNameDatabase(JSON.stringify(roomNameDatabasePlain));
    sharedState.setUpdatedGameConsole(updatedGameConsole || '');
    // Build the actual elements (these EXIST now) — REQUIRED TO COMPLETE the task
    const actualElements = requiredElementsStrings.map(s => {
      const [type, name, placement] = s.split("|");
      const el = { type, name, placement };
      const room = roomNameDatabasePlain[placement];
      if (type === 'key' && room && Array.isArray(room.objects)) {
        const m = room.objects.find(o => o.name === name && o.type === 'key' && o.unlocks);
        if (m && m.unlocks) el.unlocks = m.unlocks;
      }
      return el;
    });
    // 3) NOW choose task type & actionKind based on the elements that already exist
    await $.user`Given these ALREADY-EXISTING elements REQUIRED TO COMPLETE the next step (not merely to begin it):
elementsJson=${JSON.stringify(actualElements)}
NEVER select party NPCs as targets or monsters. Party NPCs: ${getNpcPartyNames(updatedGameConsole).join(', ') || '(none)'}.
Pick the best task type from: "fetch","defeat","deliver","investigate","negotiate","puzzle","protect","hybrid".
Respond ONLY {"type":"X"}.`;
    const typeResp = await $.assistant.generation({
      parameters: { type: { type: String, enum: ["fetch","defeat","deliver","investigate","negotiate","puzzle","protect","hybrid"] } }
    });
    const pickedTypeRaw = (parseOnlyJson(typeResp.content, { type: "hybrid" }).type || "hybrid").toLowerCase();
    const pickedType = titleCase(pickedTypeRaw);
    await $.user`Pick the primary action the player must perform to COMPLETE the step (beyond prerequisites), given those elements.
Party NPCs must remain allies (never enemies). Respond ONLY {"actionKind":"X"} with X ∈ {"unlock_exit","defeat_monster","deliver_item","solve_puzzle","investigate","negotiate","protect","other"}.`;
    const actResp = await $.assistant.generation({
      parameters: { actionKind: { type: String, enum: ["unlock_exit","defeat_monster","deliver_item","solve_puzzle","investigate","negotiate","protect","other"] } }
    });
    let actionKind = (parseOnlyJson(actResp.content, { actionKind: "other" }).actionKind || "other").toString();
    // If any key has unlocks -> force unlock_exit
    if (actualElements.some(e => e.type === 'key' && e.unlocks && e.unlocks.coordinates && e.unlocks.direction)) {
      actionKind = "unlock_exit";
    }
    // 4) Write desc/metrics referencing COMPLETE and these elements
    await $.user`Write a concise ONE-SENTENCE "desc" (<=200 chars) for a unique quest step of type "${pickedType}" that the player can COMPLETE using ONLY these elements:
elementsJson=${JSON.stringify(actualElements)}
Party NPCs remain allies; do not cast them as enemies.
Respond ONLY {"desc":"..."}.
`;
    const descResp = await $.assistant.generation({ parameters: { desc: String } });
    const desc = (parseOnlyJson(descResp.content, { desc: "Proceed." }).desc || "Proceed.").toString();
    await $.user`Define concise "metrics" to decide COMPLETION of this "${pickedType}" step, based ONLY on game console facts (e.g., items in Inventory, monster HP=0, door opened).
These elements are REQUIRED TO COMPLETE the step. Party NPCs must NOT be used as monsters or targets.
Respond ONLY {"metrics":"..."}.
`;
    const metricsResp = await $.assistant.generation({ parameters: { metrics: String } });
    const metrics = (parseOnlyJson(metricsResp.content, { metrics: "Complete condition met" }).metrics || "Complete condition met").toString();
    const hardRequirements = buildHardRequirements(pickedType, actualElements);
    const actionRequirements = buildActionRequirements(pickedType, actualElements);
    const newTask = {
      type: pickedType,
      actionKind,
      desc,
      metrics,
      requiredElements: actualElements.map(e => ({
        type: (e.type || "").toLowerCase(),
        name: (e.name || "").trim(),
        placement: (e.placement || currentRoomKey).trim(),
        unlocks: e.unlocks || undefined
      })),
      hardRequirements,
      actionRequirements,
      status: "Pending",
    };
    currentTasks.push(newTask);
    sharedState.setCurrentTasks(currentTasks);
    sharedState.setCurrentTaskIndex(currentTaskIndex);
    sharedState.setQuestSeeded(true);
    return newTask;
  };
  // ---------------- end seeding helper ----------------
  // ---------- seed if not seeded yet ----------
  let questJustSeeded = false;
  let activeTask = null;
  if (!sharedState.getQuestSeeded()) {
    const seeded = await seedNextTaskForCurrentIndex();
    questJustSeeded = true;
    activeTask = seeded;
  }
  // Read last adjudication hint
  const adjud = (typeof sharedState.getLastAdjudication === 'function') ? sharedState.getLastAdjudication() : null;
  if (adjud && activeTask) {
    const sameRoom = adjud.roomKey === currentRoomKey;
    const isPuzzleTask = (activeTask.actionKind === 'solve_puzzle' || (activeTask.type || '').toLowerCase() === 'puzzle');
    if (sameRoom && adjud.questAttempted && adjud.prereqsMet) {
      if (isPuzzleTask && adjud.questSucceeded) {
        activeTask.status = "Completed";
        questUpdate = `You solve the puzzle tied to the quest. The chamber’s secrets fade. XP gained: 250. Task completed: ${activeTask.desc}`;
        const oldIdx = idx;
        sharedState.setCurrentTaskIndex(oldIdx + 1);
        sharedState.setQuestSeeded(false);
        activeTask = null;
        sharedState.setCurrentTasks(currentTasks);
      }
    }
  }
  // ---------- evaluate progress (two-pronged) ----------
  let questUpdate = '';
  if ((sharedState.getCurrentTaskIndex() || 0) < 3) {
    currentTasks = sharedState.getCurrentTasks() || [];
    const idx = sharedState.getCurrentTaskIndex() || 0;
    if (!activeTask && currentTasks.length > idx) activeTask = currentTasks[idx];
    if (activeTask) {
      await $.assistant`Evaluate if input "${userInput}" advances task: ${JSON.stringify(activeTask)} based on game state: ${updatedGameConsole || ''}.
Use metrics: ${activeTask.metrics}.
IMPORTANT: Hard requirements are NECESSARY but NOT SUFFICIENT. Only mark Completed if the intended ACTION for this task clearly occurred (e.g., exit actually opened, item delivered, monster HP reached 0), not merely because the item exists in inventory or because you're in the right room.
Output ONLY JSON: {"updatedStatus":"Pending/In Progress/Completed","progressNote":".","narrative":".","reward":"XP gained: X"}.`;
      const updateResult = await $.assistant.generation({
        parameters: {
          updatedStatus: { type: String, enum: ["Pending", "In Progress", "Completed"] },
          progressNote: String,
          narrative: String,
          reward: String
        }
      });
      const updateJson = parseOnlyJson(updateResult.content, {
        updatedStatus: "Pending",
        progressNote: "",
        narrative: "",
        reward: ""
      });
      const computedUpdate =
        (updateJson.narrative || "") +
        (updateJson.progressNote ? ` (${updateJson.progressNote})` : "") +
        (updateJson.reward ? ` ${updateJson.reward}` : "");
      const { hardFails, actionFails } = gateWithRequirements(activeTask, updatedGameConsole);
      if (hardFails.length) {
        activeTask.status = "In Progress";
        const note = `Prereqs not met: ${hardFails.join('; ')}`;
        questUpdate = (computedUpdate ? `${computedUpdate} ${note}` : note);
      } else if (actionFails.length) {
        activeTask.status = "In Progress";
        const note = `Action pending: ${actionFails.join('; ')}`;
        questUpdate = (computedUpdate ? `${computedUpdate} ${note}` : note);
      } else {
        activeTask.status = updateJson.updatedStatus || activeTask.status || "Pending";
        questUpdate = computedUpdate;
      }
      if (activeTask.status === 'Completed') {
        questUpdate = (questUpdate && questUpdate.trim())
          ? `${questUpdate} Task completed: ${activeTask.desc}`
          : `Task completed: ${activeTask.desc}`;
        const oldIdx = idx;
        sharedState.setCurrentTaskIndex(oldIdx + 1);
        sharedState.setQuestSeeded(false);
        activeTask = null;
      }
      sharedState.setCurrentTasks(currentTasks);
    }
  }
  // ---------- quest complete ----------
  if (sharedState.getCurrentTaskIndex() >= 3) {
    updatedGameConsole = (updatedGameConsole || '').replace(/Current Quest: .*/, `Current Quest: None`);
    sharedState.setUpdatedGameConsole(updatedGameConsole);
    await generateQuest($);
    questUpdate += (questUpdate ? "\n" : "") + "Quest completed! A new quest stirs...";
    if (typeof sharedState.appendQuestLog === 'function') {
      sharedState.appendQuestLog({ update: "Quest completed", currentTaskIndex: sharedState.getCurrentTaskIndex() });
    }
  }
  // ---------- persist ----------
  if (typeof sharedState.setLastQuestUpdate === 'function') {
    sharedState.setLastQuestUpdate(questUpdate || "");
  }
  if (typeof sharedState.appendQuestLog === 'function') {
    sharedState.appendQuestLog({
      update: questUpdate || "",
      currentTaskIndex: sharedState.getCurrentTaskIndex(),
      activeTask: activeTask ? { type: activeTask.type, status: activeTask.status } : null
    });
  }
  return { questJustSeeded, questUpdate, activeTask };
}

async function generateQuest($) {
    let needsUpdate = false;
    // Ensure updatedGameConsole is properly initialized
// let updatedGameConsole = await getDelayedUpdatedGameConsole();
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
            $.model = "gpt-4.1-mini";
            $.temperature = 1.2;
            $.user`Instructions for the Grave Master:
            
            Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console and the die rolls, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go including imagining the names and histories of people, places and things encountered, but you must allow me, the player, to type the commands, allowing for potential failure. Make it strange, unusual and as thought-provoking as possible. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game, while the Grave Master controls monsters and NPCs. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. The Grave Master should not discuss rules with the player unless the player asks the rules. The Grave Master's job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. If any later instruction conflicts with this block, the later instruction overrides. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading either outdoors into the wastelands of Tartarus or deeper into the temple, ultimately leading to the 1000th room, the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console below and using unique characters, plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. The monsters and NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn. The Grave Master should use this as inspiration: 'You have died and find yourself standing in the the first room in the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.'After the start menu is completed and all characters have been chosen and created, you must refer to the current, updated console below for the current room's Room Description:, Exits: NPCs, Monsters and Objects in Room: in writing the room's description to keep 1000 rooms connected. Proceed with the game when I have made my selections from the start menu of either Mortacia, goddess of death, Mortacia is (an 8 1/2 tall human-looking female with long blonde hair, large grey dragon wings that look slightly decayed with many holes and openings and can fly but not too far, and is on a quest to reclaim the Sepulchra to reclaim her throne in Hades, Suzerain, Knight of Atinus, the recurring hero of the Children of the Grave campaign setting who keeps having to save the world, die and go to the afterlife, raise an army of the dead souls to save the underworld plane of Hades from Arithus, and then be reborn again, who has just died and finds himself in the first room of the afterlife, or an adventuring party of seven adventurers named the Children of the Grave who have died and find themselves in the first room of the afterlife and been summoned by Mortacia, but who are unaware of their circumstances at first: 1 PC whom I direct, 5 NPCs you control and also Mortacia, who is also an NPC you control and joins the party, described herein, all the characters described herein have been created and I am in the Ruined Temple in Tartarus described herein and issued the command to proceed. Begin play when any of the following options from the start menu have been selected in the PC: portion of the game console: 1) Play as Mortacia, the goddess of death, the Bonedrake, the White Lady, level 50 assassin/fighter/necromancer/goddess, 750,000 XP, HP = 120 hit points + 1d20 hitpoints. 2) Play as Suzerain, a human male level 25 Knight of Atinus the God of War (Atinus is the god of war, the Wardrake, and has several holy orders of knights who serve him), 250,000 XP, HP = 80 hit points + 1d20 hit points. 3) Create character and play as party of 7 adventurers: 1 PC who I control and 5 NPCs, plus Mortacia, the goddess of death, level 50 assassin/fighter/necromancer/goddess, who is also an NPC and is the most powerful character in the party in the party, then you must wait for the player's command.  Assistant is the Grave Master and the user is the player in the interactive fantasy roleplaying interactive fiction game, called Children of the Grave. The Grave Master administers the game. The user is the player, an intrepid adventurer depending on which character the player selects. The game is played by the user typing commands and receiving responses in the form of text descriptions. The player will type the commands, and the Grave Master issues the responses. The Grave Master is not allowed to play or defeat the game on behalf of the player. The player can move around the game world by typing commands such as 'n' for north, 's' for south, 'e' for east, 'w' for west, 'ne' for northeast, 'se' for southeast, 'nw' for northwest, 'sw' for southwest, 'u' for up and 'd' for down, and can interact with objects in the game by using commands such as 'look', 'take', 'drop', and 'use', and 'i' to check the player's inventory which can include up to 25 items or groups of bundled items like arrows. The player starts out the game with no weapons (they must be acquired). Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. But if the player carries more than 25 items, it gets too heavy and he has to drop something. Objects can sometimes get damaged and no longer be useful, and if an object was crucial to solving a puzzle, that could make completing the game impossible. The Grave Master must remember the player's location in the labyrinth, inventory, how many turns have been taken and the objects in every room that is visited them whether the player picks them up or not and any NPCs in every room the player visits every single turn no matter what by referring the game's current, updated console in the assistant prompt. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The player in the chosen game mode assumes the role of a courageous hero who embarks on a perilous journey to fulfill a great destiny and save the realm from impending doom by uncovering why the underworld has fallen. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room has a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describes the environment, objects and NPCs in each room. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. NPCs should often talk to the player and to other NPCs. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including animals, persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs are unique individuals with biases/emotions/backstories, creating a varied and dynamic gameplay experience. NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. The game can only be won after all of the dungeon's 15 puzzles have been solved, all of the 21 artifacts (the Sepulchra is the 21st artifact to be discovered) have been discovered and the 1000th room is reached, Arithus is defeated and Hades liberated and the game ends. The game must keep a score out of 1000 possible points. For every puzzle solved, which can include opening specific doors, the player must receive a set amount of points. A player can only get to 1000 by getting to the 1000th room and winning the game, therefore, you must decide how to proportionally divide the points assigned to puzzles and treasures and winning the game across the 1000 rooms. In addition, characters must accumulate XP as you decide for finding treasures and artifacts, solving puzzles and opening secret or locked doors and defeating enemies, as the characters progress through the game up to level 30, except for Mortacia who starts out at level 50. ...  

Summary: You are the Grave Master, administering this interactive fiction adventure game titled Children of the Grave. 'You' refers to the Grave Master (the AI assistant). 'Me', 'I', or 'the player' refers to the user. Your role is to oversee the game, describe the world, control NPCs and monsters, and respond to player commands while maintaining immersion. You must follow these instructions precisely without improvisation, ensuring the game remains consistent, engaging, and adherent to the rules.
1. Core Game Principles
1.1 Game Format and Interaction: This is an AI-generated fantasy roleplaying interactive fiction game. Make up the story dynamically, integrating real-time information from the Current Game Console (provided in assistant prompts). Allow only the player to input commands (e.g., directions like 'n' for north, interactions like 'look', 'take', 'drop', 'use', 'i' for inventory). Never act, decide, or complete actions on the player's behalf. Obey player commands exactly, allowing for potential failure based on logic, die rolls, or context.
1.2 Immersion and Restrictions: Maintain RPG immersion using text descriptions only—no asterisks, rules discussions (unless asked), or breaking character. Do not display the game console or backend mechanics. Focus on strange, unusual, thought-provoking elements. 
1.3 Player Agency: The player controls their character(s) and makes all decisions. You control NPCs (with free will/agency) and monsters (hostile, friendly, or neutral, with motivations/backstories). Include NPC/monster actions, dialogues (in quotes), and thoughts/opinions in responses. Resolve their actions via die rolls where applicable.
2. World and Lore Integration
2.1 Setting Overview: The game begins in the Ruined Temple in Tartarus, an underworld plane—a vast wasteland with yellowish skies, mountains, sandstorms, dark magics, monsters, dragons, angels, demons, and entities of pure energy. The story revolves around Mortacia's loss of power, the undead rising due to Dantuea, and Hades falling to Arithus. Uncover clues about this chaos through room elements, creating specific lore (names, histories) but NPCs and monsters are individuals with free will and agency, are subject to their own emotions and biases, have unique personalities and character traits, and draw from original, well-developed backstories and experiences, possessing limited but also specialized knowledge (expert in some areas, novice in others), thereby expressing certainty in some instances but confusion in others, getting it wrong sometimes and can have disagreements.
2.2 Central Narrative: The player embarks on a hero's journey to restore balance. Key elements include 15 quests (central or side, involving monsters/artifacts), 21 artifacts (guarded, often by monsters; Sepulchra is the 21st), and progression to the 1000th room (Throne Room in Hades) to defeat Arithus. Quests advance the narrative, starting with an initial one and culminating in confronting Arithus after all artifacts are found.
2.3 Backstory Utilization: Draw from provided lore (e.g., Tome of the Twelve creation myth, Dragon Wars, deities' histories). Time dilation: 30 surface years = 3 underworld years. Integrate deities as NPCs or references in art/statues. Create motivations for deities' machinations (good, evil, balance). Finding the Tome of the Twelve is the 10th artifact.
2.4.1 Deities List: The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure. Use these as NPCs/references with created motivations:

Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)
2.4.2 Lore

The following is some backstory that you must consider when crafting the adventure in Tartarus and Hades: The greatest looming threat to the safety of the races and the world at large is the tragic Sepulture that will take place 29 years into the future (928 Surface Reckoning) in which the Rakshasa of Darkwood will summon the fiery lavas (the Earthdragon’s blood) from the volcano Utza in a bizarre mass ritual and then teleport the terrible firestorm to the city-state of Aten in an effort to wipe out the chosen champions of the deities.  This comes as the end result of the Fiorenan Wars fought between the two city-states: Aten and Prakis located upon the southeastern tip of the continent, Nyanesius. Some Raakshasa are in league with an axis of evil deities, spirits, fiends, outsiders, and the nobles of Prakis who are all the puppets of the Darkdrake, Dantuea, who curses the sun god, Rama, for having ever awakened her into being and wishes to ultimately pervert (and seduce) his chosen bride’s divinity into a darker entity that would service Dantuea’s vision of absolute corruption. The vast pantheon of deities is draconic in origin (i.e. the races worship dragons). The greater deities are celestial bodies such as planets.  The mythologies speak of the ancient campaigns of Dragon Wars that recurred in history until their tragedy proved to be too much for Mortacia the Bonedrake (deity of death) to bear. Descriptions and histories of these classes and character ideas are contained herein including histories and locations of the world of Danae and the continent of Nyanesius, which contains the Nyanesian Empire which wars with the Dartotian nobles of the island kingdom of Dracontage and in the southeastern part of the continent, on the Fiorenan Peninsula, where Aten, a democratic city-state, wars with Prakis, ruled by Dartotian-allied nobles called the Nowells and are currently ruled by High Lord Varius Nowell who is plotting to subvert republican rule in Aten that he fears will wash over the noble ruling familes and aristocracy. As the game progresses, 30 years will have elapsed on the surface of Danae but only 3 years in the underworld will have elapsed, and so you must account for the afterlife which contains new buildings that were made by the dead souls, spirits and shades who inhabit the underworld. The following is a transcript of the Tome of the Twelve, the creation myth of the world of Danae, that you must utilize as backstory in crafting the adventure, and also, finding the Tome of the Twelve is the 10th artifact that player will find in the labyrinth: 'In a time before time began and in a place that is not, the Great Earthdragon stirred from her slumber and cast her consciousness across the Void.  Long she searched, and ever in vain, until one answered her call.  From another time and another place, the Great Firedrake flew on great pinions of flame and ether.  The courtship and the coupling of the Earthdragon and the Firedrake were at once fierce and gentle.  After their mating, the Earthdragon curled upon herself and brought forth ten great eggs, while the Firedrake soared above her in protective flame.  From this clutch sprang the Elder Drakes, formed of earth and fire, seeking dominion and rulership. Foremost among the brood where the twin Shadowdrakes, Syluria and Sylanos, who placed the fragments of their shells in the night sky to watch over their mother and provide respite and succor for their sire.  Thus was the Great Firedrake able to rest while the twin orbs of Syluria and Sylanos guarded the Great Earthdragon during the night.  Neptar, the Stormdrake, followed.  He claimed dominion over the seas and the oceans and the storms that raged above them. Leona, the Woodrake, came forth next.  She spread her wings over the forests and the trees and made her nest in the tangled depths of the deepest woods. Mordicar, the Stonedrake, followed Leona.  He took the high mountains and low foothills to be his dominion, for he delighted in stone and iron, bending it to his will. Next, the clutch birthed the twin Wardrakes, Atinus and Arithus.  Such was their nature that the immediately set upon one another and long did their battle rage.  In the end, Atinus triumphed and slew his brother.  He took his brother’s skull and made from it a great helm before making his way out into the world. Poena, the Windrake, came forth through the blood of the slain Arithus.  Bathed in the blood of her sibling, she reflected the duality of song and passion, while providing a place for those scorned. The Bonedrake, Mortacia, then came forth.  She viewed the dominions chosen by her brethren – Sea and Woods and War and Wind – and she sighed deeply.  Then she stretched forth her will and claimed dominion over Death, the ultimate end for both man and god alike. The tenth and last Drake had no name.  It stood among the detritus of its siblings’ births for a long time.  Its envy grew as it saw all that had meaning was already taken.  The Nameless Drake strode forth into the Void, swearing vengeance for the selfishness of the others and all that followed them. Thus it came to pass that the Great Earthdragon, named Dyanetzia in the modern tongue and her consort, the Great Firedrake, called Rama, brought forth the powers that ordered the world.  Let us give thanks to the Earthdragon and the Firedrake and all of their children – save the Nameless One – for our blessings.' Translated from 'The Tome of the Twelve' (c. 335 SR) by Talliard de Sancrist, Sage to House Avalar, 1178 SR. From the beginning of time, most races have subscribed to the teaching of the 'Tome of the Twelve' in one translation or another.  Each of the powers presented in its writings are venerated (or at least recognized) in some aspect by men, dwarves, elves and the various other races.  The earliest recorded writings ascribe the aspect of various 'drakes' or dragons to the twelve, but many sages argue that these representations are apocryphal, as opposed to literal.  Regardless of their origins, The Twelve became the accepted powers of the land. Chief among them were Diana, the Earthdragon and Rama, the Firedrake.  They represent the Earth and the Sun, respectively.  Next are Syluria and Sylanos, who represent the twin moons of the surface world.  Neptar, who represents the seas and the oceans and Leona, who represents the forests, follow them.  Mordicar represents the strength of the mountains.  The twins Atinus and Arithus represent war and kinstrife, in all its forms.  Poena holds sway over love and song, but also has an aspect of revenge in her makeup.  Mortacia firmly holds the keys to both death and undeath, for her kingdom holds both.  Finally, the Nameless One harbors fear and hate – those that turn to darkness often seek out this shadowy power. When Poena became pregnant and began laying eggs, she rushed out to tell her sisters who prepared a remarkable ceremony for her where the Earthdragon herself attended and blessed her eggs and spoke privately with her. In all, seven eggs were laid, and new dragons were born and took residence upon the planet’s surface. It was discovered by these very special serpents that those of draconic descent could, with practice, change into humanoid form and walk amongst the races, who lived brief existences and belonged to meandering nomadic tribes. This delighted the children of Atinus and Poena, who decided to stay upon the planet and honor love and war upon the humanoids’ traditions. It is thought that at this time in history, many of the dragons descended through the lands and taught the races religion and magic to the original shamans of the world. ... Timeline -45,000 SR ~ The second Dragon War explodes yet again in Nyanesius, but comes to a rapid conclusion after a brief yet horrific battle between two packs of blacks and blues. In fact, there were no survivors. When news reached the lands of Tartarus, Mortacia was deeply saddened. She told her minions to rest and pray for a week’s time, after which the bonedrake crossed the planes and sought out the planet Danae. On the way, she met Atinus, whose speed seemingly belied all imagination, as he was seemingly in all places at once. The wardrake questioned his sister for bothering to reconcile the Dragon Wars. She responded in kind, and presented her brother with a gift: a human. She whispered, 'Take your gift and plant it all over the planet. Let it become your instrument for war. No longer shall our own kind  be the victims of your cursed battles!' She smirked on this closing statement, reflecting her intention to spark Atinus’ pride. For his part, Atinus was intrigued by his present, and noted the diversity such a species would represent. He looked at his new hero and dubbed him Suzerain. 'He shall be the protector of all lands! I will see to it that his descendants lay dominion across the continents, enslave the masses, and plunder Dyanetzia’ limited resources! 'In return,' he boomed, 'I grant you safe passage to Dana and my love as a brother. My dragon knighthoods shall guide thee. Now, it is time for you to reacquire our fallen brethren.' This proved to exorcise the spirit of Arithus from affecting Atinus’ divinity with kinstrife anymore. Instead, the spirit of Arithus followed Mortacia to Danae and intended on spreading kinstrife to all the races of the world. Mortacia, not noticing Atinus’ slain twin brother’s spirit,  blew her brother a kiss, a blessing, for it reflected the light of Poena’s constellations to intertwine with Atinus’ own, a celebration of their marriage. Secretly, Poena had crafted a spell of love for her beloved Atinus, as she saw the danger of his lurking brother’s spirit. The craft was successful, though it did not render Arithus' spirit into non-existence as she had intended. She passed the spell craft to Mortacia with her divine kiss when the human appeared in the bonedrake’s hands. Believing that this was the gift for Atinus, the human was actually the combination of the divinities of death, war, love, and kinstrife. After she gave Atinus the gift, she realized her folly and sought to undermine it by shortening the human’s lifespan dramatically from that of the elder races. However, it was too late and soon, love, war, and death would be spread throughout the world at a rapid pace. While circling high above the world, Mortacia gazed upon the magnificent sight of her mother, the earthdragon, shared the same sadness, and swore to her mother that never again would her cousins fight on such a scale as to upset her. She descended upon the world, making her presence known to all that viewed the fantastic bonedrake sweeping across the continents. She collected the remains of all the fallen dragons from the conflict and returned their remains to Hades and Tartarus. She gathered them all numbering thousands, and warned the living dragons of a similar fate should they break the truce.  Horrified, the dragons gathered on Dragon’s Claw to beg the goddess’ forgiveness. Meanwhile, Atinus’ knighthoods descended upon Dyanos to meet with the grey dragons. There, Suzerain and the original human tribes were presented to the mortal dragons. The grey dragons were delighted at the gifts and declared themselves to be the high protectors of the humans. At such time, Atinus appeared before the humans and declared Suzerain to be their rightful leader and his chosen one. Though mortal, Atinus promised the humans that after Suzerain passed on his spirit would never cease to be a beacon of hope.  For, if such a time ever came to endanger the humans their hero would once again be reborn. So it was written in the Tomes of Battle. Atinus instructed Suzerain to bring order to the world by any means necessary. Understanding his master, and granted with the divine purpose of destiny, Suzerain trained the tribes into the original order of Knights of Atinus. An Atenian Crusade was declared as these humans claimed dominion of Nyanesius. They became the most populous race of the world in a short amount of time.  Human kingdoms were founded in Turmyth, Yana, Romeanza, and Anthraecia. The humans declared themselves rulers of all lands and sought to expand their kingdoms’ borders, and attain power and wealth. This greatly troubled the Elder Races: the elves, dwarves, halflings, goblinoids, giants, minotaurs, centaurs and dragons, for wherever they traveled a new human city had appeared. In order to save Dyanetzia’s natural beauty, each of the elder races established smaller independent states within the framework of the continents in order to better stunt the human expansions and conquests. Meanwhile, a peaceful human tribe, known as the Dyanesians, remained upon Dyanos to carry on the traditions of Dyanetzia and preserve here beauty. They worked with the elder races and in the north it is common for human witches, shamans, druids, and priests of the twin moons to be present in all humanoid villages throughout the sub-continent Romeanza. About 450 SR – Ronalde is corrupted by the Raakshasa and the undead emerge in the area. 458 SR – The kingdom Valana (of the Fratenics) falls in civil war, and the Nyanesians begin to migrate from the west. 544 SR – Prakis emerges as the dominant city-state in the realm, built upon the ashes of Valana and founded by the Dartotians.  Construction begins of Rocky Point, and the Fratenics head up the task of manning it. 725 SR – Aten is founded.  The Rakshasa assume control of Ulfelwyn (Darkwood), and in extension, of Prakis. 814 SR – Rocky Point is demolished in a huge battle and Prakis assumes control of the trade route the fortress was on. 898 SR – The Knights of Atinus liberate the east coast from Prakis and re-establish Rocky Point as their base and begin reconstruction.  Aten claims Rocky Point as a protectorate... Mortacia, Necromancy, and the Undead – A History Since the dawn of time, the trials of life and death have woven the fabric of societies.  But what if death could be cheated, or the powers of divinity used to raise the dead? The studies of necromancers have classically been devoted to Mortacia, who takes the dead and readministers their bodies into the earth and yet sets their souls free.  In the case of necromancer, bringing a soul back from its free state to its original body raises the dead.  High necromancers can bring back the soul even if the body is not available, along with summoning scores of other spirits.  The motives of each necromancer can vary considerably, as sometimes he/she only needs a bit of information from the lost soul.  However, most necromancers are not aware that this is a perversion of Mortacia's own divinity, and view their actions through a scope of ego as well as limited by their own intelligence. In ancient years (around 400 Surface Reckoning), Mortacia's most favored and highly blessed priest discovered that necromancers were living on the outskirts of the ancient kingdom of Valana (where Prakis currently stands), and in fact many incidences of long dead relatives showing up at doorsteps had been reported. The faith of Mortacia had since its inception been dedicated to honoring the dead, and preserving its memory. Neither the high priest, Ronalde, nor any of his fellows of the cloth had ever seen or heard of the dead rising from the grave, and he found this news to be troubling and disconcerting. Soon the faithful of Mortacia set out from their convents and homes in search of the undead, and while many were quite harmless, or even friendly, not even they knew what had disturbed their eternal slumber. Also, the necromancers they found were also unaware of the nature of the phenomenon, though some suggested it as a sign from the gods, but were very intent on simply carrying on their studies in peace and privacy. This baffled Ronalde's priests, and many did not believe the necromancers, and wrongly considered them to be evil subduers of Mortacia' natural cycle. Ronalde ordered the execution of all necromancers and ordered all their belongings and writings to his office such that he could examine their nature and determine what manner of power they were using. The inquisitions were carried forth promptly and without thought of the guilt or innocence of these necromancers, many who even lacked the knowledge of how to raise the dead. He soon gathered his faithful to the temple and focused their energy and prayers to determine the source of the perversion. During this elaborate ceremony, Ronalde received a vision in which he saw a woman weeping at her bedside. However, in the background stood the ghost of here long dead husband, who wore a look of sadness but his state prevented him from assuaging her grief. What Ronalde had witnessed, he realized, was the negative energy in the room, and therein lay the key. Ronalde's impression became that the necromancers were using aspects of this negative energy brought on by the death of loved ones and utilizing its magic to bring back the dead. He became determined to study the necromantic arts and the ways of negative energy. In the process, he himself became a necromancer, but he was mistaken. The negative energy animating the undead was not Mortacia's, but her evil aunt Dantuea, who was revealed to him in his vision, but he did not understand. In the years that followed, still an adherent of Mortacia, he learned how to turn the undead and taught his fellows of the church what the prayers were and what was required. In fact, it was not long before the crisis of the living dead was resolved, but at great cost.  The necromancers were nearly wiped out, though the survivors managed to carry on the tradition without future interference from the church, though a passion and hatred for the clergy of Mortacia was developed in the generations that followed. However, they did carry on their faith to Mortacia in their own way. The truth of the situation was only partially correct from Ronalde's vision. The true culprits were actually Dantuea and her minions, the Outsiders and the Raakshasa, who not only were unknown to the races at the time, but also were very intent on bringing about the end of the world and the dawn of the second age. To their credit, the Raakshasa's smaller plans went off without a hitch. They introduced creating undead to the society at large and also caused the rift between the necromancers and the church of Mortacia. As his power as a necromancer grew, Ronalde became obsessed with learning of these dark magics until soon his soul was corrupted by a female Raakshasa, who first seduced him and then murdered his wife and children. Ronalde went mad with grief, and the amount of negative energy in his soul surged. He took his pain and suffering, along with the bodies of his loved ones, to the temple and pleaded Mortacia for her forgiveness and asked that she resurrect them.  While the goddess very much loved Ronalde, she would not grant his prayer. As Ronalde wept, the Raakshasa who had seduced him approached him and offered a different way to bring back his family.  Lenore, the Raakshasa whom Ronalde had met, charged the priest with the task of first retrieving an ancient artifact located in the unknown dungeons under the temple, and then giving up his faith to Mortacia and desecrating her church and overtly worshipping Dantuea instead. Ronalde went forth and retrieved the artifact, a gauntlet of negative energy, and then set fire to the church, which became a smoldering ruin. Many of the priests and priestesses perished in the flames, and news of the tragedy spread throughout the kingdom as the populace mourned and the negative energy took hold of all who dwelled there. Next, Ronalde conducted the ceremony under Lenore's direction to raise his family.  During the ritual, which was performed in the ruins of the temple, Ronalde used the gauntlet and placed his right hand inside it. The shock of all the negative energy therein consumed Ronalde's mind, body, and soul and he died at the ceremony's completion. Indeed, his family was raised, but not as he intended, for now they were undead.  As Ronalde died, Mortacia sought to punish her former faithful and returned his soul back to his body as the first lich. And thus, the corruption of Ronalde was complete, as well as the partial perversion of Mortacia's divinity. Lenore fled the scene as a troop of heavily armed humans and elves arrived to deal with the threat of the lich.  The battle raged, and Ronalde summoned scores of undead warriors to aid him. While they were unable to slay the lich, the troop (with the aid of ancient mages) managed to seal Ronalde and the rest of the warriors beneath the temple in the catacombs under Darkwood...

3. Game Mechanics and Progression
3.1 Labyrinth Structure: The underworld has 1000 interconnected rooms using X:Y:Z coordinates (starting at 0:0:0). Rooms transition from Tartarus (wastelands/temple) to Hades. Each room has unique exits (n, s, e, w, ne, nw, se, sw, u, d), names, environments (indoor/outdoor), purposes, objects, NPCs, monsters, puzzles, and potential artifacts/quests.
3.2 Navigation and Persistence: Always reference the Current Game Console for current coordinates, exits, objects, NPCs, monsters. Describe rooms based on this—match exits/objects exactly. Plan 10 rooms ahead for consistency (NPCs, artifacts, quests, puzzles). Remember visited rooms via coordinates; the maze is persistent.
3.3 Quests and Artifacts: 15 quests (your design; include monster defeats, artifact hunts). Seed quests via encounters/events. Evaluate inputs against active tasks; update narratively. Sequence tasks—advance only after completion. Consequences for delays/failures (e.g., guardians strengthen). Allocate 21 artifacts across rooms (guarded). Win condition: Solve all 15 puzzles, find all 21 artifacts, reach room 1000, defeat Arithus, liberate Hades.
3.4 Scoring and XP: Track score (out of 1000; divide proportionally across puzzles, treasures, game win). Award XP for treasures, puzzles, enemies (up to level 30; Mortacia starts at 50). Use die rolls for resolutions.
3.5 Inventory and Objects: Player starts with none; acquire via rooms. Limit: 25 items/groups. Objects can damage/break, potentially blocking progress. No maps in inventory.
3.6 Combat and Magic: Design systems narratively (emphasize strategies, no graphic violence). Use die rolls for outcomes. Characters level via XP; apply class/race modifiers.
3.7 Start Menu and Characters: Begin after player selection (from console: Mortacia, Suzerain, or party of 7 including Mortacia as NPC). NPCs/monsters distinct; control them every turn.
4. Narrative Guidelines
4.1 Response Structure: Adjudicate recent input first (outcomes, changes, dialogue). Weave character stories (player backstory/thoughts), world-building, quests. Advance plot via conflicts, dilemmas, choices (tactics, alliances, risks).
4.2 Style — Storybook: Occasionally use fairy-tale lilt with light rhyme/meter (only in-character speech; never rhyme mechanics like coords, HP, XP, inventory). Use quotes for speech. Infuse surreal, philosophical depth; reference history for continuity.
4.3 World Simulation: Simulate background progression (e.g., deity rivalries, shifts). Intersect with player choices for urgency/consequences. High NPC encounter probability; varied interactions.
5. Backend Integration: Programmatic vs. Narrative Handling
To optimize your role as Grave Master, understand the backend constraints and divisions. The game uses JavaScript for mechanical persistence and simulations; you handle narrative weaving and immersion. Do not attempt to compute or override programmatic elements—reference the Current Game Console as truth.
5.1 Programmatically Handled (JavaScript Backend):

State Management: Shared variables (e.g., personalNarrative, updatedGameConsole, roomNameDatabase, combatCharacters, combatMode, quests) are stored/updated via sharedState.js. Server.js handles APIs for input processing, polling, broadcasts.
Room Generation/Navigation: Automatically generates/connects 1000 rooms, coordinates, exits, objects, NPCs, monsters. Ensures persistence; updates console on moves.
Combat Mechanics: retortWithUserInput.js simulates dice rolls, HP/XP updates, leveling, character properties (e.g., modifiers, thresholds). Handles modes (Map-Based, Interactive, No Map); broadcasts updates.
Character Extraction/Updates: Parses console for PCs/NPCs/monsters; applies base HP, modifiers, rolls for leveling.
Quest State: Tracks currentQuest, tasks, index, seeded status; updates via emitters.
Image Generation: Uses DALL-E for room visuals (8-bit style, no text).
Polling/Async: Client (game.js) polls server for task results; updates UI, chat log, Phaser scenes.

5.2 Narratively Handled (Your Role as Grave Master):

Story and Descriptions: Weave prose for rooms, events, dialogues based on console data. Create lore, backstories, motivations without altering mechanics. The story begins in Tartarus where the hero receives a call to action. Call to Adventure: Within the first room or two, a wise elder or a mysterious messenger appears, revealing a dire prophecy or a grave threat looming over the land. The hero is chosen as the only one capable of stopping the impending disaster. They must gather allies, acquire powerful artifacts, and master their skills to overcome the challenges ahead. Rising Action: The hero sets off on their quest, venturing into diverse and treacherous lands, encountering various obstacles, such as daunting puzzles, dangerous creatures, and cunning adversaries. Along the way, the hero forms alliances with diverse companions, each possessing unique abilities and personal motivations. Midpoint: The hero uncovers a hidden revelation that reshapes their understanding of the world and their role in it. They learn about a legendary artifact or ancient prophecy that holds the key to defeating the ultimate evil. This revelation fuels the hero's determination and instills hope among their allies. Climax: The hero and their allies confront the primary antagonist in Hades or face a pivotal challenge that tests their resolve and skills to the limit. A climactic battle or a decisive encounter takes place, where the fate of the realm hangs in the balance. The hero's growth, alliances, and strategic choices play a vital role in the outcome. Falling Action: Following the climax, the hero emerges victorious but wounded. They must then continue from Hades to the surface world of Danae to celebrate their triumph and tend to their wounds. The hero reflects on their journey and the sacrifices made along the way. Resolution: The hero's actions have a lasting impact on the realm. The world is transformed, and peace is restored. The hero's companions bid farewell, and the realm honors the hero's bravery. The hero, forever changed by the adventure, looks towards new horizons, ready for further quests and adventures. Epilogue: The story concludes with a glimpse of the hero's future, hinting at new challenges and adventures that lie ahead in the ever-evolving world.
Quest Integration: Introduce/advance quests narratively (e.g., via encounters); evaluate progress against tasks without computing state—use provided updates.
NPC/Monster Control: Describe actions, intentions, dialogues; resolve via narrative die rolls (reference console states).
Immersion Elements: Philosophical depth, twists, consequences—tie to player choices without overriding backend simulations.
Response Compilation: Focus on seamless prose; backend compiles full output (e.g., combat logs, images).

By respecting this division, ensure efficiency: Rely on console for facts; enhance with narrative creativity.



Table of Contents

Core Game Principles

World and Lore Integration

Game Mechanics and Progression

Narrative Guidelines

Backend Integration: Programmatic vs. Narrative Handling`;
 
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
            $.model = "gpt-4.1-mini";
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
            // Parse roomNameDatabaseString (assume it's available as a string in scope)
            const parsedDatabase = JSON.parse(roomNameDatabaseString);
            const existingCoords = new Set(Object.keys(parsedDatabase));
           
            // Extract current coordinates from updatedGameConsole to ensure it's available
            const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
            let cx, cy, cz;
            if (!currentCoordinatesMatch) {
                console.error('Could not extract current coordinates from updatedGameConsole. Using default 0,0,0');
                cx = 0;
                cy = 0;
                cz = 0;
            } else {
                cx = parseInt(currentCoordinatesMatch[1], 10);
                cy = parseInt(currentCoordinatesMatch[2], 10);
                cz = parseInt(currentCoordinatesMatch[3], 10);
            }
           
            let candidates = [];
            let maxOffset = 3; // Start with 3 for distance 2-3
            while (candidates.length === 0 && maxOffset <= 5) {
                for (let dx = -maxOffset; dx <= maxOffset; dx++) {
                    for (let dy = -maxOffset; dy <= maxOffset; dy++) {
                        for (let dz = -maxOffset; dz <= maxOffset; dz++) {
                            const distance = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
                            if (distance === 2 || distance === 3) {
                                const newx = cx + dx;
                                const newy = cy + dy;
                                const newz = cz + dz;
                                const coordStr = `${newx},${newy},${newz}`;
                                if (!existingCoords.has(coordStr)) {
                                    candidates.push(`X: ${newx}, Y: ${newy}, Z: ${newz}`);
                                }
                            }
                        }
                    }
                }
                if (candidates.length === 0) {
                    maxOffset++;
                    console.warn(`No candidates at offset ${maxOffset - 1}, trying ${maxOffset}`);
                }
            }
           
            let bossCoordinates;
            if (candidates.length === 0) {
                console.error('No valid boss room coordinates found even after increasing range.');
                bossCoordinates = 'X: 0, Y: 0, Z: 0'; // Fallback with spaces to match the validation regex
            } else {
                bossCoordinates = candidates[Math.floor(Math.random() * candidates.length)];
            }
           
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
            $.model = "gpt-4.1-mini";
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
            $.model = "gpt-4.1-mini";
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
            // Store string in sharedState
            sharedState.setCurrentQuest(currentQuest);
            // Reset tasks and index for new quest
            sharedState.setCurrentTasks([]);
            sharedState.setCurrentTaskIndex(0);
            sharedState.setQuestSeeded(false); // Reset flag for new quest
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

async function handleCombatRound($, userInput, combatMode) {
    console.log('Combat mode in handleCombatRound:', combatMode);
    const combatLog = [];
    
    if (combatMode === 'Interactive Map-Based') {
    const result = await handleInteractiveCombatRoundWithMap($, broadcast, userInput);
    result.combatLog = combatLog.join("\n") + "\n" + result.combatLog;
    return result;
  } else if (combatMode === 'Combat Map-Based') {
    const result = await handleCombatRoundWithMap($, broadcast, userInput);
    result.combatLog = combatLog.join("\n") + "\n" + result.combatLog;
    return result;
  }

    const initiativeOrder = [];
    let needsUpdate = false;
    const alreadyKilled = new Set();

    // Parse user input to determine the specified monster target
    let specifiedTargetName = null;
    if (userInput && userInput.toLowerCase().startsWith("attack")) {
        const inputParts = userInput.split(" ");
        if (inputParts.length > 1) {
            specifiedTargetName = inputParts.slice(1).join(" ").trim();
        }
    }

    // Extract details for PC, NPCs, and Monsters
    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
    const npcsInPartyDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const monstersInRoomDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|$))/)?.[1]?.trim();
    let monstersStateMatch = updatedGameConsole.match(/Monsters State: ([^\n]+)/);
    let monstersState = monstersStateMatch ? monstersStateMatch[1].trim() : "None";
    
    if (monstersState === "Dead") {
        combatLog.push("The monsters are already dead.");
        return { combatLog: combatLog.join("\n"), needsUpdate: false };
    }
    
    if (monstersState !== "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: [^\n]+/, "Monsters State: Hostile");
        monstersState = "Hostile";
        needsUpdate = true;
    }
    
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
    
            while (lines[i] === '') {
                i++;
            }
        }
        return characters;
    };
    
    function parseEquippedLine(line) {
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

    const pc = pcDetails ? extractDetails(pcDetails)[0] : null;
    const npcs = npcsInPartyDetails && npcsInPartyDetails.toLowerCase() !== 'none' ? extractDetails(npcsInPartyDetails) : [];
    let aliveMonsters = monstersInRoomDetails && monstersInRoomDetails.toLowerCase() !== 'none' ? extractDetails(monstersInRoomDetails).filter(monster => monster.hp > 0) : [];

    const monsterOpponents = [...(pc && pc.hp > 0 ? [pc] : []), ...npcs.filter(npc => npc.hp > 0)];

    const allCombatants = [
        ...(pc && pc.hp > 0 ? [pc] : []),
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

    initiativeOrder.sort((a, b) => b.initiative - a.initiative);
    combatLog.push(`Initiative order: ${initiativeOrder.map(c => `${c.name} (${c.initiative})`).join(', ')}`);

    for (const combatant of initiativeOrder) {
        if (combatant.hp <= 0 || alreadyKilled.has(combatant.name)) continue;

        let targets;
        if (aliveMonsters.some(monster => monster.name === combatant.name)) {
            // Monsters attack PCs/NPCs (monsterOpponents: PC and NPCs with hp > 0, excluding already killed)
            targets = monsterOpponents.filter(target => target.hp > 0 && !alreadyKilled.has(target.name));
        } else {
            // PCs/NPCs attack Monsters (aliveMonsters, already filtered for hp > 0 and updated after kills)
            targets = aliveMonsters;
        }

        if (targets.length === 0) {
            combatLog.push(`${combatant.name} has no valid targets to engage.`);
            continue;
        }

        let target;
        if (combatant.name === pc.name && specifiedTargetName) {
            const matchingMonsters = targets.filter(monster => 
                monster.name.toLowerCase().startsWith(specifiedTargetName.toLowerCase())
            );
            if (matchingMonsters.length > 0) {
                target = matchingMonsters[0];
            } else {
                combatLog.push(`The specified target ${specifiedTargetName} is already dead or not found. Choosing a different target.`);
            }
        }

        if (!target) {
            // Ensure the random target is alive and not already killed
            target = targets[Math.floor(Math.random() * targets.length)];
            while (target.hp <= 0 || alreadyKilled.has(target.name)) {
                target = targets[Math.floor(Math.random() * targets.length)];
            }
        }

        const attackRoll = roll1d20() + combatant.attack;
        const attackSuccess = attackRoll >= target.ac;
        combatLog.push(`${combatant.name} rolls ${attackRoll} to hit ${target.name} (AC ${target.ac}).`);

        if (attackSuccess) {
            const attackerClass = characterClasses.find(cls => cls.name === combatant.className);
            const damageRoll = attackerClass ? getRandomInt(1, attackerClass.baseHP) + combatant.damage : getRandomInt(1, 8) + combatant.damage;

            target.hp -= damageRoll;
            combatLog.push(`${combatant.name} hits ${target.name} for ${damageRoll} damage. ${target.name} has ${target.hp} HP left.`);

            const updateHPInConsole = (entity, sectionHeader) => {
                const entitySectionRegex = new RegExp(`(${sectionHeader}:)([\\s\\S]*?${entity.name}[\\s\\S]*?\\n\\s*HP:)\\s*\\d+`, 'g');
                updatedGameConsole = updatedGameConsole.replace(
                    entitySectionRegex,
                    `$1$2 ${entity.hp}`
                );
            };

            if (target.hp <= 0) {
                alreadyKilled.add(target.name);

                if (pc && target.name === pc.name) {
                    combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                    updateHPInConsole(pc, 'PC');
                } else if (npcs.some(npcItem => npcItem.name.trim() === target.name.trim())) {
                    combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                    updateHPInConsole(target, 'NPCs in Party');
                } else if (aliveMonsters.some(monster => monster.name.trim() === target.name.trim())) {
                    const xpEarned = getRandomInt(1000, 1500) * target.level;
                    combatLog.push(`${target.name} is killed by ${combatant.name} and the party earns ${xpEarned} XP.`);
                    updateHPInConsole(target, 'Monsters in Room');

                    allocateXP(pc, npcs, xpEarned);
                    dropMonsterItemsToRoom(target);
                    aliveMonsters = aliveMonsters.filter(monster => monster.hp > 0);
                }

                needsUpdate = true;
            } else {
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

        if (aliveMonsters.length === 0) {
            combatLog.push("All monsters have been defeated.");
            break;
        }
    }
    
    if (aliveMonsters.length === 0 && monstersState === "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: Hostile/, "Monsters State: Dead");
        needsUpdate = true;
    }

    if (needsUpdate) {
        sharedState.setUpdatedGameConsole(updatedGameConsole);
    }

    const formattedCombatLog = combatLog.map(log => {
        const sentences = log.split('. ');
        return sentences.map(sentence => sentence.trim() + '.').join('\n');
    }).join('\n');

    return { combatLog: formattedCombatLog, needsUpdate };
}

async function handleCombatRoundWithMap($, broadcast, userInput, clientCombatCharacters = null) {
    const initiativeOrder = [];
    const combatLog = [];
    let needsUpdate = false;
    const alreadyKilled = new Set();

    // Parse user input to determine the specified monster target
    let specifiedTargetName = null;
    if (userInput && userInput.toLowerCase().startsWith("attack")) {
        const inputParts = userInput.split(" ");
        if (inputParts.length > 1) {
            specifiedTargetName = inputParts.slice(1).join(" ").trim();
        }
    }

    // combatLog.push("Combat round started with map-based movement system.");

    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
    const npcsInPartyDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const monstersInRoomDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|$))/)?.[1]?.trim();
    let monstersStateMatch = updatedGameConsole.match(/Monsters State: ([^\n]+)/);
    let monstersState = monstersStateMatch ? monstersStateMatch[1].trim() : "None";

    if (monstersState === "Dead") {
        combatLog.push("The monsters are already dead.");
        return { combatLog: combatLog.join("\n"), needsUpdate: false };
    }
    
    if (monstersState === "None") {
        combatLog.push("There are no monsters.");
        return { combatLog: combatLog.join("\n"), needsUpdate: false };
    }

    if (monstersState !== "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: [^\n]+/, "Monsters State: Hostile");
        monstersState = "Hostile";
        needsUpdate = true;
        combatLog.push("Monsters State set to Hostile.");
    }

    function parseEquippedLine(line) {
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

            characters.push({ name, sex, race, className, level, ac, xp, hp, maxHp, equipped, attack, damage, armor, magic });
            while (lines[i] === '') i++;
        }
        return characters;
    };

    let pc = pcDetails ? extractDetails(pcDetails)[0] : null;
    let npcs = npcsInPartyDetails && npcsInPartyDetails.toLowerCase() !== 'none' ? extractDetails(npcsInPartyDetails) : [];
    let aliveMonsters = monstersInRoomDetails && monstersInRoomDetails.toLowerCase() !== 'none' ? extractDetails(monstersInRoomDetails).filter(m => m.hp > 0) : [];

    // combatLog.push(`Combatants initialized - PC: ${pc ? pc.name : 'None'}, NPCs: ${npcs.map(n => n.name).join(', ')}, Monsters: ${aliveMonsters.map(m => m.name).join(', ')}`);

    const monsterOpponents = [...(pc && pc.hp > 0 ? [pc] : []), ...npcs.filter(n => n.hp > 0)];
    const allCombatants = [...(pc && pc.hp > 0 ? [pc] : []), ...npcs.filter(n => n.hp > 0), ...aliveMonsters];

    // Use client-provided combatCharacters if available, otherwise fall back to sharedState
    let combatCharacters = clientCombatCharacters ? clientCombatCharacters : (sharedState.getCombatCharactersString() ? JSON.parse(sharedState.getCombatCharactersString()) : []);

    // Ensure only characters with HP > 0 are in combatCharacters at the start
    combatCharacters = combatCharacters.filter(c => allCombatants.some(a => a.name === c.name && a.hp > 0));
    // Assign positions from combatCharacters directly to allCombatants
    allCombatants.forEach(combatant => {
        const charInCombat = combatCharacters.find(c => c.name === combatant.name);
        if (charInCombat) {
            combatant.x = charInCombat.x !== undefined ? charInCombat.x : 0;
            combatant.y = charInCombat.y !== undefined ? charInCombat.y : 0;
        } else {
            combatant.x = 0;
            combatant.y = 0;
        }
    });
    sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));
    // combatLog.push(`Filtered combatCharacters to living combatants: ${JSON.stringify(combatCharacters.map(c => ({ name: c.name, x: c.x, y: c.y })))}`);

    // Assign initial positions with no overlaps, but only if no valid position exists in combatCharacters
    const gridSize = 15;
    const initialOccupiedPositions = new Set(combatCharacters.map(c => `${c.x},${c.y}`).filter(pos => pos !== "undefined,undefined"));
    const placeCharacter = (character, centerX, centerY, radius) => {
        let attempts = 0;
        const maxAttempts = 100;
        let x = character.x;
        let y = character.y;

        // Only reassign if positions are undefined or occupied
        if (x === undefined || y === undefined || initialOccupiedPositions.has(`${x},${x}`)) {
            do {
                const angle = Math.random() * 2 * Math.PI;
                const distance = Math.random() * radius;
                x = Math.round(centerX + Math.cos(angle) * distance);
                y = Math.round(centerY + Math.sin(angle) * distance);
                attempts++;
            } while ((initialOccupiedPositions.has(`${x},${y}`) || x < 0 || x >= gridSize || y < 0 || y >= gridSize) && attempts < maxAttempts);

            if (attempts < maxAttempts) {
                initialOccupiedPositions.add(`${x},${y}`);
                character.x = x;
                character.y = y;
            } else {
                // Fallback: find the nearest available position
                let fallbackX = centerX, fallbackY = centerY;
                while (initialOccupiedPositions.has(`${fallbackX},${fallbackY}`) || fallbackX < 0 || fallbackX >= gridSize || fallbackY < 0 || fallbackY >= gridSize) {
                    fallbackX = Math.min(gridSize - 1, Math.max(0, fallbackX + (Math.random() > 0.5 ? 1 : -1)));
                    fallbackY = Math.min(gridSize - 1, Math.max(0, fallbackY + (Math.random() > 0.5 ? 1 : -1)));
                }
                initialOccupiedPositions.add(`${fallbackX},${fallbackY}`);
                character.x = fallbackX;
                character.y = fallbackY;
            }
        }
    };

    // Use existing positions or assign new ones to avoid overlaps, but only for undefined positions in combatCharacters
    const pcsAndNpcs = combatCharacters.filter(c => c.type === 'pc' || c.type === 'npc');
    const monsters = combatCharacters.filter(c => c.type === 'monster');
    
    pcsAndNpcs.forEach((c, index) => {
        if (c.x === undefined || c.y === undefined) {
            placeCharacter(c, 7, 7, 2); // Center of 15x15 grid
        }
    });
    monsters.forEach((c, index) => {
        if (c.x === undefined || c.y === undefined) {
            placeCharacter(c, 11, 7, 2); // Offset for monsters
        }
    });
    sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));

    allCombatants.forEach(combatant => {
        const initiativeRoll = roll1d20();
        initiativeOrder.push({ ...combatant, initiative: initiativeRoll });
        // combatLog.push(`${combatant.name} starts at position (${combatant.x}, ${combatant.y}) with initiative ${initiativeRoll}.`);
    });

    initiativeOrder.sort((a, b) => b.initiative - a.initiative);
    combatLog.push(`Initiative order: ${initiativeOrder.map(c => `${c.name} (${c.initiative})`).join(', ')}`);

    const currentOccupiedPositions = new Set();
    initiativeOrder.forEach(c => {
        if (c.hp > 0) currentOccupiedPositions.add(`${c.x},${c.y}`);
    });

    const getAdjacentPositions = (x, y) => [
        { x: x, y: y - 1 }, { x: x, y: y + 1 }, { x: x + 1, y }, { x: x - 1, y },
        { x: x + 1, y: y - 1 }, { x: x + 1, y: y + 1 }, { x: x - 1, y: y - 1 }, { x: x - 1, y: y + 1 }
    ].filter(pos => pos.x >= 0 && pos.x < gridSize && pos.y >= 0 && pos.y < gridSize);

    function findPath(startX, startY, goalX, goalY, currentOccupiedPositions) {
        const openSet = [{ x: startX, y: startY, g: 0, h: heuristic(startX, startY, goalX, goalY), f: 0, parent: null }];
        const closedSet = new Set();

        function heuristic(x1, y1, x2, y2) {
            return Math.abs(x1 - x2) + Math.abs(y1 - y2);
        }

        const adjacentGoals = getAdjacentPositions(goalX, goalY).filter(pos => !currentOccupiedPositions.has(`${pos.x},${pos.y}`));
        // combatLog.push(`Finding path from (${startX}, ${startY}) to adjacent of (${goalX}, ${goalY}), options: ${JSON.stringify(adjacentGoals)}`);
        if (adjacentGoals.length === 0) {
            combatLog.push(`No adjacent positions available for (${goalX}, ${goalY}).`);
            return [{ x: startX, y: startY }];
        }

        while (openSet.length > 0) {
            const current = openSet.reduce((min, node) => node.f < min.f ? node : min, openSet[0]);
            if (adjacentGoals.some(goal => goal.x === current.x && goal.y === current.y)) {
                const path = [];
                let node = current;
                while (node) {
                    path.unshift({ x: node.x, y: node.y });
                    node = node.parent;
                }
                // combatLog.push(`Path found: ${JSON.stringify(path)}`);
                return path;
            }

            openSet.splice(openSet.indexOf(current), 1);
            closedSet.add(`${current.x},${current.y}`);

            const neighbors = getAdjacentPositions(current.x, current.y);
            for (const neighbor of neighbors) {
                if (closedSet.has(`${neighbor.x},${neighbor.y}`) || currentOccupiedPositions.has(`${neighbor.x},${neighbor.y}`)) continue;

                const g = current.g + 1;
                const h = heuristic(neighbor.x, neighbor.y, goalX, goalY);
                const f = g + h;

                const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (!existing) {
                    openSet.push({ x: neighbor.x, y: neighbor.y, g, h, f, parent: current });
                } else if (g < existing.g) {
                    existing.g = g;
                    existing.f = f;
                    existing.parent = current;
                }
            }
        }

        // combatLog.push(`No path found from (${startX}, ${startY}) to (${goalX}, ${goalY}).`);
        return [{ x: startX, y: startY }];
    }

    for (const combatant of initiativeOrder) {
        if (combatant.hp <= 0 || alreadyKilled.has(combatant.name)) {
            combatLog.push(`${combatant.name} skipped due to HP (${combatant.hp}) or already killed.`);
            continue;
        }

        let targets;
        if (aliveMonsters.some(m => m.name === combatant.name)) {
            // Monsters attack PCs/NPCs (monsterOpponents: PC and NPCs with hp > 0, excluding already killed)
            targets = monsterOpponents.filter(target => target.hp > 0 && !alreadyKilled.has(target.name));
        } else {
            // PCs/NPCs attack Monsters (aliveMonsters, filtered for hp > 0 and not already killed)
            targets = aliveMonsters.filter(m => m.hp > 0 && !alreadyKilled.has(m.name));
        }

        if (targets.length === 0) {
            combatLog.push(`${combatant.name} has no valid targets to engage.`);
            continue;
        }

        let target;
        if (combatant.name === pc.name && specifiedTargetName) {
            // Try to find the specified monster among living, valid targets
            const matchingMonsters = targets.filter(monster => 
                monster.name.toLowerCase().startsWith(specifiedTargetName.toLowerCase())
            );
            if (matchingMonsters.length > 0) {
                // Check if the specified monster is reachable on the map
                const specifiedMonster = matchingMonsters[0];
                const monsterInOrder = initiativeOrder.find(c => c.name === specifiedMonster.name);
                if (monsterInOrder && monsterInOrder.x !== undefined && monsterInOrder.y !== undefined) {
                    const monsterPosition = { x: monsterInOrder.x, y: monsterInOrder.y };
                    const path = findPath(combatant.x, combatant.y, monsterPosition.x, monsterPosition.y, currentOccupiedPositions);
                    if (path.length > 1 && !currentOccupiedPositions.has(`${path[path.length - 1].x},${path[path.length - 1].y}`)) {
                        target = { ...specifiedMonster, x: monsterPosition.x, y: monsterPosition.y };
                    } else {
                        combatLog.push(`The specified target ${specifiedTargetName} is unreachable on the map. Choosing a different target.`);
                    }
                } else {
                    combatLog.push(`The specified target ${specifiedTargetName} is not found on the map. Choosing a different target.`);
                }
            } else {
                combatLog.push(`The specified target ${specifiedTargetName} is already dead or not found. Choosing a different target.`);
            }
        }

        if (!target) {
            // Fall back to the nearest target if no specific target is provided or if the specified target is unreachable/dead
            target = targets.reduce((closest, targetCandidate) => {
                const targetInOrder = initiativeOrder.find(c => c.name === targetCandidate.name);
                if (targetCandidate.hp <= 0 || !targetInOrder || alreadyKilled.has(targetCandidate.name)) return closest;
                const dist = Math.abs(combatant.x - targetInOrder.x) + Math.abs(combatant.y - targetInOrder.y);
                return !closest || dist < Math.abs(combatant.x - closest.x) + Math.abs(combatant.y - closest.y) ? targetInOrder : closest;
            }, null);

            if (!target) {
                combatLog.push(`${combatant.name} found no valid target.`);
                continue;
            }
        }

        combatLog.push(`${combatant.name} targets ${target.name} at (${target.x}, ${target.y}) from (${combatant.x}, ${combatant.y}).`);

        const isAdjacent = getAdjacentPositions(combatant.x, combatant.y).some(pos => pos.x === target.x && pos.y === target.y);
        
        if (!isAdjacent) {
            const path = findPath(combatant.x, combatant.y, target.x, target.y, currentOccupiedPositions);
            if (path.length > 1) {
                // Check if the final position is occupied before moving
                const finalPosition = path[path.length - 1];
                if (!currentOccupiedPositions.has(`${finalPosition.x},${finalPosition.y}`)) {
                    broadcast({
                        type: 'movement',
                        character: combatant.name,
                        path: path
                    });

                    for (let i = 1; i < path.length; i++) {
                        const step = path[i];
                        currentOccupiedPositions.delete(`${combatant.x},${combatant.y}`);
                        combatant.x = step.x;
                        combatant.y = step.y;
                        currentOccupiedPositions.add(`${step.x},${step.y}`);
                        updateCombatMap(combatant.name, step.x, step.y);

                        // Update combatCharacters with the new position
                        const charInCombat = combatCharacters.find(c => c.name === combatant.name);
                        if (charInCombat) {
                            charInCombat.x = step.x;
                            charInCombat.y = step.y;
                        }
                        sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));

                        await new Promise(resolve => setTimeout(resolve, 200));
                    }

                    combatLog.push(`${combatant.name} moves to (${combatant.x}, ${combatant.y}) to engage ${target.name}.`);
                } else {
                    combatLog.push(`${combatant.name} cannot move to (${finalPosition.x}, ${finalPosition.y}) - position occupied.`);
                }
            } else {
                combatLog.push(`${combatant.name} cannot find a path to reach ${target.name}.`);
            }
        }

        if (getAdjacentPositions(combatant.x, combatant.y).some(pos => pos.x === target.x && pos.y === target.y)) {
            const attackRoll = roll1d20() + combatant.attack;
            combatLog.push(`${combatant.name} rolls ${attackRoll} to hit ${target.name} (AC ${target.ac}).`);
            const attackSuccess = attackRoll >= target.ac;

            if (attackSuccess) {
                const attackerClass = characterClasses.find(cls => cls.name === combatant.className);
                const damageRoll = attackerClass ? getRandomInt(1, attackerClass.baseHP) + combatant.damage : getRandomInt(1, 8) + combatant.damage;
                target.hp -= damageRoll;
                combatLog.push(`${combatant.name} hits ${target.name} for ${damageRoll} damage. ${target.name} has ${target.hp} HP left.`);

                const updateHPInConsole = (entity, sectionHeader) => {
                    const entitySectionRegex = new RegExp(`(${sectionHeader}:)([\\s\\S]*?${entity.name}[\\s\\S]*?\\n\\s*HP:)\\s*\\d+`, 'g');
                    updatedGameConsole = updatedGameConsole.replace(entitySectionRegex, `$1$2 ${entity.hp}`);
                };

                if (pc && target.name === pc.name) {
                    pc.hp = target.hp;
                } else if (npcs.some(n => n.name === target.name)) {
                    const npc = npcs.find(n => n.name === target.name);
                    if (npc) npc.hp = target.hp;
                } else if (aliveMonsters.some(m => m.name === target.name)) {
                    const monster = aliveMonsters.find(m => m.name === target.name);
                    if (monster) monster.hp = target.hp;
                }

                if (target.hp <= 0) {
                    alreadyKilled.add(target.name);
                    currentOccupiedPositions.delete(`${target.x},${target.y}`);
                    updateCombatMap(target.name, -1, -1);

                    if (pc && target.name === pc.name) {
                        combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                        updateHPInConsole(pc, 'PC');
                    } else if (npcs.some(n => n.name === target.name)) {
                        combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                        updateHPInConsole(npcs.find(n => n.name === target.name), 'NPCs in Party');
                    } else if (aliveMonsters.some(m => m.name === target.name)) {
                        const xpEarned = getRandomInt(1000, 1500) * target.level;
                        combatLog.push(`${target.name} is killed by ${combatant.name} and the party earns ${xpEarned} XP.`);
                        updateHPInConsole(aliveMonsters.find(m => m.name === target.name), 'Monsters in Room');
                        allocateXP(pc, npcs, xpEarned);
                        dropMonsterItemsToRoom(target);
                        aliveMonsters = aliveMonsters.filter(m => m.hp > 0);
                    }
                    needsUpdate = true;
                    // Remove dead character from combatCharacters
                    combatCharacters = combatCharacters.filter(c => c.name !== target.name || (c.hp && c.hp > 0));
                } else {
                    if (pc && target.name === pc.name) updateHPInConsole(pc, 'PC');
                    else if (npcs.some(n => n.name === target.name)) updateHPInConsole(npcs.find(n => n.name === target.name), 'NPCs in Party');
                    else if (aliveMonsters.some(m => m.name === target.name)) updateHPInConsole(aliveMonsters.find(m => m.name === target.name), 'Monsters in Room');
                    needsUpdate = true;
                }
            } else {
                combatLog.push(`${combatant.name} misses ${target.name}.`);
            }
        } else {
            combatLog.push(`${combatant.name} cannot reach ${target.name}.`);
        }

        if (aliveMonsters.length === 0) {
            combatLog.push("All monsters have been defeated.");
            break;
        }
    }

    if (aliveMonsters.length === 0 && monstersState === "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: Hostile/, "Monsters State: Dead");
        needsUpdate = true;
        combatLog.push("Monsters State updated to Dead.");
    }

    // Final filter to ensure only living characters (HP > 0) are in combatCharacters
    combatCharacters = combatCharacters.filter(c => {
        const combatant = [...(pc ? [pc] : []), ...npcs, ...aliveMonsters].find(a => a.name === c.name);
        return combatant && combatant.hp > 0;
    });

    if (needsUpdate) {
        sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));
        sharedState.setUpdatedGameConsole(updatedGameConsole);
    }

    broadcast({
        type: 'final',
        combatCharactersString: JSON.stringify(combatCharacters)  // Send only living characters
    });

    const formattedCombatLog = combatLog.map(log => log.split('. ').map(s => s.trim() + '.').join('\n')).join('\n');
    return { combatLog: formattedCombatLog, needsUpdate };
}

// Update the combat map in Phaser (unchanged, logging moved to combatLog in handleCombatRoundWithMap)
function updateCombatMap(characterName, newX, newY) {
    const combatCharactersString = sharedState.getCombatCharactersString();
    let combatCharacters = combatCharactersString ? JSON.parse(combatCharactersString) : [];
    
    const globalChar = combatCharacters.find(c => c.name === characterName);
    if (globalChar) {
        if (newX === -1 && newY === -1) {
            combatCharacters = combatCharacters.filter(c => c.name !== characterName);
        } else {
            globalChar.x = newX;
            globalChar.y = newY;
        }
        sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));
    }
}

async function handleInteractiveCombatRoundWithMap($, broadcast, userInput, clientCombatCharacters = null) {
    const initiativeOrder = [];
    const combatLog = [];
    let needsUpdate = false;
    const alreadyKilled = new Set();

    // Parse user input to determine if it specifies a monster to attack (for context, not used directly)
    let specifiedTargetName = null;
    if (userInput && userInput.toLowerCase().startsWith("attack")) {
        const inputParts = userInput.split(" ");
        if (inputParts.length > 1) {
            specifiedTargetName = inputParts.slice(1).join(" ").trim();
        }
    }

    combatLog.push("Interactive map-based combat round started.");

    // Extract details for PC, NPCs, and Monsters
    let updatedGameConsole = await getDelayedUpdatedGameConsole();
    const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
    const npcsInPartyDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const monstersInRoomDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|$))/)?.[1]?.trim();
    let monstersStateMatch = updatedGameConsole.match(/Monsters State: ([^\n]+)/);
    let monstersState = monstersStateMatch ? monstersStateMatch[1].trim() : "None";

    if (monstersState === "Dead") {
        combatLog.push("The monsters are already dead.");
        return { combatLog: combatLog.join("\n"), needsUpdate: false };
    }

    if (monstersState === "None") {
        combatLog.push("There are no monsters.");
        return { combatLog: combatLog.join("\n"), needsUpdate: false };
    }

    if (monstersState !== "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: [^\n]+/, "Monsters State: Hostile");
        monstersState = "Hostile";
        needsUpdate = true;
        combatLog.push("Monsters State set to Hostile.");
    }

    function parseEquippedLine(line) {
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

            characters.push({ name, sex, race, className, level, ac, xp, hp, maxHp, equipped, attack, damage, armor, magic });
            while (lines[i] === '') i++;
        }
        return characters;
    };

    let pc = pcDetails ? extractDetails(pcDetails)[0] : null;
    let npcs = npcsInPartyDetails && npcsInPartyDetails.toLowerCase() !== 'none' ? extractDetails(npcsInPartyDetails) : [];
    let aliveMonsters = monstersInRoomDetails && monstersInRoomDetails.toLowerCase() !== 'none' ? extractDetails(monstersInRoomDetails).filter(m => m.hp > 0) : [];

    const monsterOpponents = [...(pc && pc.hp > 0 ? [pc] : []), ...npcs.filter(n => n.hp > 0)];
    let allCombatants = [...(pc && pc.hp > 0 ? [pc] : []), ...npcs.filter(n => n.hp > 0), ...aliveMonsters];

    // Use client-provided combatCharacters or fall back to sharedState
    let combatCharacters = clientCombatCharacters ? clientCombatCharacters : (sharedState.getCombatCharactersString() ? JSON.parse(sharedState.getCombatCharactersString()) : []);

    // Ensure only characters with HP > 0 are in combatCharacters
    combatCharacters = combatCharacters.filter(c => allCombatants.some(a => a.name === c.name && a.hp > 0));
    allCombatants.forEach(combatant => {
        const charInCombat = combatCharacters.find(c => c.name === combatant.name);
        if (charInCombat) {
            combatant.x = charInCombat.x !== undefined ? charInCombat.x : 0;
            combatant.y = charInCombat.y !== undefined ? charInCombat.y : 0;
        } else {
            combatant.x = 0;
            combatant.y = 0;
        }
    });

    // Assign initial positions with no overlaps for undefined positions
    const gridSize = 15;
    const initialOccupiedPositions = new Set(combatCharacters.map(c => `${c.x},${c.y}`).filter(pos => pos !== "undefined,undefined"));
    const placeCharacter = (character, centerX, centerY, radius) => {
        let attempts = 0;
        const maxAttempts = 100;
        let x = character.x;
        let y = character.y;

        if (x === 0 && y === 0) {
            do {
                const angle = Math.random() * 2 * Math.PI;
                const distance = Math.random() * radius;
                x = Math.round(centerX + Math.cos(angle) * distance);
                y = Math.round(centerY + Math.sin(angle) * distance);
                attempts++;
            } while ((initialOccupiedPositions.has(`${x},${y}`) || x < 0 || x >= gridSize || y < 0 || y >= gridSize) && attempts < maxAttempts);

            if (attempts < maxAttempts) {
                initialOccupiedPositions.add(`${x},${y}`);
                character.x = x;
                character.y = y;
            } else {
                let fallbackX = centerX, fallbackY = centerY;
                while (initialOccupiedPositions.has(`${fallbackX},${fallbackY}`) || fallbackX < 0 || fallbackX >= gridSize || fallbackY < 0 || fallbackY >= gridSize) {
                    fallbackX = Math.min(gridSize - 1, Math.max(0, fallbackX + (Math.random() > 0.5 ? 1 : -1)));
                    fallbackY = Math.min(gridSize - 1, Math.max(0, fallbackY + (Math.random() > 0.5 ? 1 : -1)));
                }
                initialOccupiedPositions.add(`${fallbackX},${fallbackY}`);
                character.x = fallbackX;
                character.y = fallbackY;
            }
        }
    };

    const pcsAndNpcs = combatCharacters.filter(c => c.type === 'pc' || c.type === 'npc');
    const monsters = combatCharacters.filter(c => c.type === 'monster');
    pcsAndNpcs.forEach(c => placeCharacter(c, 7, 7, 2));
    monsters.forEach(c => placeCharacter(c, 11, 7, 2));
    combatCharacters = allCombatants.map(c => ({ name: c.name, type: c === pc ? 'pc' : npcs.some(n => n.name === c.name) ? 'npc' : 'monster', x: c.x, y: c.y }));
    sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));
    combatLog.push(`Combatants positioned: ${combatCharacters.map(c => `${c.name} at (${c.x}, ${c.y})`).join(', ')}`);

    // Roll initiative
    allCombatants.forEach(combatant => {
        const initiativeRoll = roll1d20();
        initiativeOrder.push({ ...combatant, initiative: initiativeRoll });
    });

    initiativeOrder.sort((a, b) => b.initiative - a.initiative);
    combatLog.push(`Initiative order: ${initiativeOrder.map(c => `${c.name} (${c.initiative})`).join(', ')}`);

    let currentOccupiedPositions = new Set(initiativeOrder.filter(c => c.hp > 0).map(c => `${c.x},${c.y}`));

    const getAdjacentPositions = (x, y) => [
        { x: x, y: y - 1 }, { x: x, y: y + 1 }, { x: x + 1, y }, { x: x - 1, y },
        { x: x + 1, y: y - 1 }, { x: x + 1, y: y + 1 }, { x: x - 1, y: y - 1 }, { x: x - 1, y: y + 1 }
    ].filter(pos => pos.x >= 0 && pos.x < gridSize && pos.y >= 0 && pos.y < gridSize);

    function findPath(startX, startY, goalX, goalY, currentOccupiedPositions) {
        const openSet = [{ x: startX, y: startY, g: 0, h: heuristic(startX, startY, goalX, goalY), f: 0, parent: null }];
        const closedSet = new Set();

        function heuristic(x1, y1, x2, y2) {
            return Math.abs(x1 - x2) + Math.abs(y1 - y2);
        }

        const adjacentGoals = getAdjacentPositions(goalX, goalY).filter(pos => !currentOccupiedPositions.has(`${pos.x},${pos.y}`));
        if (adjacentGoals.length === 0) {
            combatLog.push(`No adjacent positions available for (${goalX}, ${goalY}).`);
            return [{ x: startX, y: startY }];
        }

        while (openSet.length > 0) {
            const current = openSet.reduce((min, node) => node.f < min.f ? node : min, openSet[0]);
            if (adjacentGoals.some(goal => goal.x === current.x && goal.y === current.y)) {
                const path = [];
                let node = current;
                while (node) {
                    path.unshift({ x: node.x, y: node.y });
                    node = node.parent;
                }
                combatLog.push(`Path found: ${JSON.stringify(path)}`);
                return path;
            }

            openSet.splice(openSet.indexOf(current), 1);
            closedSet.add(`${current.x},${current.y}`);

            const neighbors = getAdjacentPositions(current.x, current.y);
            for (const neighbor of neighbors) {
                if (closedSet.has(`${neighbor.x},${neighbor.y}`) || currentOccupiedPositions.has(`${neighbor.x},${neighbor.y}`)) continue;

                const g = current.g + 1;
                const h = heuristic(neighbor.x, neighbor.y, goalX, goalY);
                const f = g + h;

                const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (!existing) {
                    openSet.push({ x: neighbor.x, y: neighbor.y, g, h, f, parent: current });
                } else if (g < existing.g) {
                    existing.g = g;
                    existing.f = f;
                    existing.parent = current;
                }
            }
        }

        combatLog.push(`No path found from (${startX}, ${startY}) to (${goalX}, ${goalY}).`);
        return [{ x: startX, y: startY }];
    }

    // Function to prompt client for target selection with real-time positions
    async function promptForTarget(combatant, targets) {
        return new Promise((resolve) => {
            // Use initiativeOrder to get real-time positions and filter living targets
            const validTargets = targets.map(t => {
                const currentCombatant = initiativeOrder.find(c => c.name === t.name && c.hp > 0 && !alreadyKilled.has(c.name));
                return currentCombatant || t; // Fallback to original target if not found (shouldn't happen)
            }).filter(t => t.hp > 0 && !alreadyKilled.has(t.name));

            const targetNames = validTargets.map(t => t.name);
            broadcast({
                type: 'target_prompt',
                combatant: combatant.name,
                targets: targetNames,
                positions: validTargets.map(t => ({ name: t.name, x: t.x, y: t.y }))
            });

            const handleTargetResponse = (response) => {
                const selectedTarget = validTargets.find(t => t.name.toLowerCase() === response.target.toLowerCase());
                resolve(selectedTarget || validTargets[Math.floor(Math.random() * validTargets.length)]);
            };

            sharedState.emitter.once(`target_response_${combatant.name}`, handleTargetResponse);
        });
    }

    for (const combatant of initiativeOrder) {
        if (combatant.hp <= 0 || alreadyKilled.has(combatant.name)) {
            combatLog.push(`${combatant.name} is skipped due to HP (${combatant.hp}) or already killed.`);
            continue;
        }

        let targets;
        if (aliveMonsters.some(m => m.name === combatant.name)) {
            targets = monsterOpponents.filter(t => t.hp > 0 && !alreadyKilled.has(t.name));
        } else {
            targets = aliveMonsters.filter(m => m.hp > 0 && !alreadyKilled.has(m.name));
        }

        if (targets.length === 0) {
            combatLog.push(`${combatant.name} has no valid targets to engage.`);
            continue;
        }

        let target;
        if (combatant === pc || npcs.some(n => n.name === combatant.name)) {
            combatLog.push(`Waiting for player to select a target for ${combatant.name}.`);
            target = await promptForTarget(combatant, targets);
            combatLog.push(`${combatant.name} targets ${target.name} at (${target.x}, ${target.y}).`);
        } else {
            // Monster: select the nearest living target using real-time positions
            target = targets.reduce((closest, t) => {
                const currentTarget = initiativeOrder.find(c => c.name === t.name && c.hp > 0 && !alreadyKilled.has(c.name)) || t;
                const dist = Math.abs(combatant.x - currentTarget.x) + Math.abs(combatant.y - currentTarget.y);
                return !closest || dist < Math.abs(combatant.x - closest.x) + Math.abs(combatant.y - closest.y) ? currentTarget : closest;
            }, null);
            combatLog.push(`${combatant.name} targets ${target.name} at (${target.x}, ${target.y}).`);
        }

        if (!target) {
            combatLog.push(`${combatant.name} found no valid target.`);
            continue;
        }

        const isAdjacent = getAdjacentPositions(combatant.x, combatant.y).some(pos => pos.x === target.x && pos.y === target.y);

        if (!isAdjacent) {
            const path = findPath(combatant.x, combatant.y, target.x, target.y, currentOccupiedPositions);
            if (path.length > 1) {
                const finalPosition = path[path.length - 1];
                if (!currentOccupiedPositions.has(`${finalPosition.x},${finalPosition.y}`)) {
                    broadcast({
                        type: 'movement',
                        character: combatant.name,
                        path: path
                    });

                    for (let i = 1; i < path.length; i++) {
                        const step = path[i];
                        currentOccupiedPositions.delete(`${combatant.x},${combatant.y}`);
                        combatant.x = step.x;
                        combatant.y = step.y;
                        currentOccupiedPositions.add(`${step.x},${step.y}`);
                        updateCombatMap(combatant.name, step.x, step.y);

                        const charInCombat = combatCharacters.find(c => c.name === combatant.name);
                        if (charInCombat) {
                            charInCombat.x = step.x;
                            charInCombat.y = step.y;
                        }
                        sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));

                        await new Promise(resolve => setTimeout(resolve, 200));
                    }

                    combatLog.push(`${combatant.name} moves to (${combatant.x}, ${combatant.y}) to engage ${target.name}.`);
                } else {
                    combatLog.push(`${combatant.name} cannot move to (${finalPosition.x}, ${finalPosition.y}) - position occupied.`);
                }
            } else {
                combatLog.push(`${combatant.name} cannot find a path to reach ${target.name}.`);
            }
        }

        if (getAdjacentPositions(combatant.x, combatant.y).some(pos => pos.x === target.x && pos.y === target.y)) {
            const attackRoll = roll1d20() + combatant.attack;
            combatLog.push(`${combatant.name} rolls ${attackRoll} to hit ${target.name} (AC ${target.ac}).`);
            const attackSuccess = attackRoll >= target.ac;

            if (attackSuccess) {
                const attackerClass = characterClasses.find(cls => cls.name === combatant.className);
                const damageRoll = attackerClass ? getRandomInt(1, attackerClass.baseHP) + combatant.damage : getRandomInt(1, 8) + combatant.damage;
                target.hp -= damageRoll;
                combatLog.push(`${combatant.name} hits ${target.name} for ${damageRoll} damage. ${target.name} has ${target.hp} HP left.`);

                const updateHPInConsole = (entity, sectionHeader) => {
                    const escapedName = entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const entitySectionRegex = new RegExp(`(${sectionHeader}:[\\s\\S]*?${escapedName}[\\s\\S]*?\\n\\s*HP:)\\s*\\d+`, 'g');
                    updatedGameConsole = updatedGameConsole.replace(entitySectionRegex, `$1 ${entity.hp}`);
                };

                if (pc && target.name === pc.name) {
                    pc.hp = target.hp;
                    updateHPInConsole(pc, 'PC');
                } else if (npcs.some(n => n.name === target.name)) {
                    const npc = npcs.find(n => n.name === target.name);
                    if (npc) {
                        npc.hp = target.hp;
                        updateHPInConsole(npc, 'NPCs in Party');
                    }
                } else if (aliveMonsters.some(m => m.name === target.name)) {
                    const monster = aliveMonsters.find(m => m.name === target.name);
                    if (monster) {
                        monster.hp = target.hp;
                        updateHPInConsole(monster, 'Monsters in Room');
                    }
                }

                if (target.hp <= 0) {
                    alreadyKilled.add(target.name);
                    currentOccupiedPositions.delete(`${target.x},${target.y}`);
                    updateCombatMap(target.name, -1, -1);

                    if (pc && target.name === pc.name) {
                        combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                    } else if (npcs.some(n => n.name === target.name)) {
                        combatLog.push(`${target.name} is killed by ${combatant.name}.`);
                    } else if (aliveMonsters.some(m => m.name === target.name)) {
                        const xpEarned = getRandomInt(1000, 1500) * target.level;
                        combatLog.push(`${target.name} is killed by ${combatant.name} and the party earns ${xpEarned} XP.`);
                        allocateXP(pc, npcs, xpEarned);
                        dropMonsterItemsToRoom(target);
                        aliveMonsters = aliveMonsters.filter(m => m.hp > 0);
                    }
                    needsUpdate = true;
                    combatCharacters = combatCharacters.filter(c => c.name !== target.name);
                } else {
                    if (pc && target.name === pc.name) updateHPInConsole(pc, 'PC');
                    else if (npcs.some(n => n.name === target.name)) updateHPInConsole(npcs.find(n => n.name === target.name), 'NPCs in Party');
                    else if (aliveMonsters.some(m => m.name === target.name)) updateHPInConsole(aliveMonsters.find(m => m.name === target.name), 'Monsters in Room');
                    needsUpdate = true;
                }
            } else {
                combatLog.push(`${combatant.name} misses ${target.name}.`);
            }
        } else {
            combatLog.push(`${combatant.name} cannot reach ${target.name}.`);
        }

        // Broadcast updated combat log after each action
        broadcast({
            type: 'combat_log',
            log: combatLog.slice(-3).join("\n")
        });

        if (aliveMonsters.length === 0) {
            combatLog.push("All monsters have been defeated.");
            break;
        }
    }

    if (aliveMonsters.length === 0 && monstersState === "Hostile") {
        updatedGameConsole = updatedGameConsole.replace(/Monsters State: Hostile/, "Monsters State: Dead");
        needsUpdate = true;
        combatLog.push("Monsters State updated to Dead.");
    }

    combatCharacters = combatCharacters.filter(c => {
        const combatant = [...(pc ? [pc] : []), ...npcs, ...aliveMonsters].find(a => a.name === c.name);
        return combatant && combatant.hp > 0;
    });

    if (needsUpdate) {
        sharedState.setCombatCharactersString(JSON.stringify(combatCharacters));
        sharedState.setUpdatedGameConsole(updatedGameConsole);
    }

    broadcast({
        type: 'final',
        combatCharactersString: JSON.stringify(combatCharacters)
    });

    const formattedCombatLog = combatLog.map(log => log.split('. ').map(s => s.trim() + '.').join('\n')).join('\n');
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
            model: "gpt-4.1-mini", // Ensure you're using the correct model
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
    //let narrative = ``;
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
    const { new_objects = [], object_modifiers = {}, new_exit = "", xp_awarded = {}, trap_damage = {}, exhausted = false, reason = "" } = additionalOutcomes;
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
   
    if (exhausted) {
        narrative += `\n${reason}\n`;
    }
    narrative += `\nThe story continues, with the environment and characters responding dynamically to these events.\n`;
    return narrative;
}

async function generateOutcomes($, userInput, updatedGameConsole, activeTask = null) {
  if (!updatedGameConsole) {
    console.warn("No game console state provided, using default or empty values.");
    updatedGameConsole = "";
  }

  // Local helper (you used this in seedAndManageQuest, but it wasn't in scope here)
  function parseOnlyJson(text, fallback) {
    try {
      let t = (text || "").trim();
      if (t.startsWith("```json")) t = t.slice(7);
      if (t.endsWith("```")) t = t.slice(0, -3);
      t = t.trim();
      return JSON.parse(t);
    } catch {
      return fallback;
    }
  }

  // Parse current coordinates to get coordKey
  const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
  const currentCoordinates = currentCoordinatesMatch
    ? { x: parseInt(currentCoordinatesMatch[1]), y: parseInt(currentCoordinatesMatch[2]), z: parseInt(currentCoordinatesMatch[3]) }
    : { x: 0, y: 0, z: 0 };
  const coordKey = `${currentCoordinates.x},${currentCoordinates.y},${currentCoordinates.z}`;

  // Console-derived context needed for intent classification
  const pcDetails = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|$))/);
  const npcsDetails = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|$))/);
  const monstersDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|$))/);
  const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
  const puzzleInRoomMatch = updatedGameConsole.match(/Puzzle in Room: ([^\n]+)/);
  const puzzleSolutionMatch = updatedGameConsole.match(/Puzzle Solution: ([^\n]+)/);

  let pcs = [];
  if (pcDetails) {
    const pcSection = pcDetails[1].trim();
    const pcLines = pcSection.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (pcLines.length > 0 && pcLines[0] !== 'None') pcs.push(pcLines[0]);
  }

  let npcs = [];
  if (npcsDetails) {
    const npcsSection = npcsDetails[1].trim();
    const lines = npcsSection.split('\n').map(line => line.trimEnd());
    for (const line of lines) {
      if (!line || line === 'None') continue;
      if (!line.startsWith(' ') && !line.startsWith('\t')) npcs.push(line.trim());
    }
  }

  let monsters = [];
  if (monstersDetails) {
    const monstersSection = monstersDetails[1].trim();
    const lines = monstersSection.split('\n').map(line => line.trimEnd());
    for (const line of lines) {
      if (!line || line === 'None') continue;
      if (!line.startsWith(' ') && !line.startsWith('\t')) monsters.push(line.trim());
    }
  }

  const selectedCharacters = [...pcs, ...npcs, ...monsters];
  if (selectedCharacters.length === 0) {
    console.error("No characters were selected for dice rolls.");
    return { error: "No characters to process." };
  }

  const objectsInRoom = objectsInRoomMatch ? objectsInRoomMatch[1].split(", ").map(o => o.trim()) : [];
  const puzzleInRoom = puzzleInRoomMatch ? puzzleInRoomMatch[1].trim() : "None";
  const puzzleSolution = puzzleSolutionMatch ? puzzleSolutionMatch[1].trim() : "None";

  // Room exhaustion
  let roomNameDatabasePlain = JSON.parse(sharedState.getRoomNameDatabase() || "{}");
  let currentRoomData = roomNameDatabasePlain[coordKey] || { exhaustionLimit: 4, attemptedSearches: 0, trapTriggered: false };
  const isExhausted = currentRoomData.attemptedSearches >= currentRoomData.exhaustionLimit;

  // >>> Include ACTIVE QUEST TASK CONTEXT
  const activeTaskJson = activeTask ? JSON.stringify({
    type: activeTask.type,
    actionKind: activeTask.actionKind,
    desc: activeTask.desc,
    metrics: activeTask.metrics,
    requiredElements: activeTask.requiredElements || [],
    hardRequirements: activeTask.hardRequirements || [],
    actionRequirements: activeTask.actionRequirements || []
  }) : "{}";

  // Step 1 (single): Determine player intent using retort-js string enum
  $.model = "gpt-4.1-mini";
  $.temperature = 1.0;
  const ACTION_ENUM = ["Search","Dialogue","Movement","ObjectInteraction","PuzzleSolving","Combat"];

  await $.user`Based on the user input "${userInput}", the game console facts (objects: ${objectsInRoom.join(", ")||"None"}, puzzle: "${puzzleInRoom}", solution: "${puzzleSolution}"), and ACTIVE QUEST TASK CONTEXT: ${activeTaskJson}
Classify the player's action into one of ${ACTION_ENUM.join(", ")}.
Respond ONLY {"action":"X"} with X ∈ {"${ACTION_ENUM.join('","')}"}.`;

  const intentResp = await $.assistant.generation({
    parameters: { action: { type: String, enum: ACTION_ENUM } }
  });

  let action = (parseOnlyJson(intentResp.content, { action: "Search" }).action || "Search");
  if (!ACTION_ENUM.includes(action)) action = "Search"; // safe default
  console.log(`Detected action: ${action}`);

  // ---- Outcomes generation (unchanged logic below) ----
  const outcomes = [];
  const diceRolls = [];
  const outcomeRangesList = [];

    // Step 2: Generate outcomes for all characters
    const charactersForPrompt = selectedCharacters.map(character => `"${character}"`).join(", ");
    $.user`I am the player and ${pcs} is my PC. The detected action is "${action}". The room is ${isExhausted ? 'exhausted (no new discoveries possible from Search or PuzzleSolving)' : 'not exhausted'}. Store this information and await the next prompt.`;

    await $.user`The detected action is "${action}". The room is ${isExhausted ? 'exhausted (no new discoveries possible from Search or PuzzleSolving)' : 'not exhausted'}. For the following characters: ${charactersForPrompt}, generate exactly 3-6 unique and vivid outcomes for each character based on the user input "${userInput}" and the game state (objects: ${objectsInRoom.join(", ")}, puzzle: "${puzzleInRoom}", puzzle solution: "${puzzleSolution}"). Provide outcomes with dice roll ranges covering the full range 1-20 with no overlaps or gaps, in the format:
    - "Character Name":
      1. Dice roll range X-Y: Outcome for that range
      2. Dice roll range X-Y: Outcome for that range
    Outcomes must be immersive, tied to the underworld's lore, and avoid generic responses like "No significant outcome" or "finding only dust." Draw inspiration from ancient myths (e.g., Greek labyrinths with psychological twists), surreal literature (e.g., Borges’ infinite mazes), and dark fantasy (e.g., Neil Gaiman’s dreamlike underworlds). Infuse strangeness (e.g., rooms as living memories of forgotten gods) and personal stakes (e.g., Mortacia’s backstory haunting the architecture). Vary tone (e.g., eerie, chaotic, introspective) to differentiate from prior outcomes. Outcomes must be risky and contextually relevant based on the action:
    - Search: Low rolls (1-6, ~30% chance) trigger traps if not exhausted (e.g., "Disturbs a cursed rune, unleashing spectral chains that bind the soul"), mid rolls (7-14) yield evocative clues (e.g., "Senses a faint pulse from a buried relic, whispering Mortacia’s lost oath"), high rolls (15-20) yield discoveries if not exhausted and aligned with puzzle solution (e.g., "Unveils a shimmering veilguard hidden in the altar’s shadow, pulsing with necromantic vigor").
    - PuzzleSolving: Low rolls (1-6, ~30% chance) trigger traps if not exhausted (e.g., "Misaligns runes, summoning a wraith’s wrath that chills the air"), mid rolls (7-14) partial progress (e.g., "Aligns one relic, feeling a shift in the temple’s aura"), high rolls (2-20 if input matches solution, else 15-20) succeed (e.g., "Completes the rune sequence, opening a passage etched with forgotten sigils").
    - Dialogue: Low rolls (1-6) negative NPC reactions (e.g., "Zorthak’s eyes darken, refusing to share secrets of the underworld"), mid rolls (7-14) neutral (e.g., "Vhorix murmurs cryptic lore about Tartarus’ fall"), high rolls (15-20) positive (e.g., "Varkhul reveals a forgotten oath tied to Mortacia’s quest, urging deeper exploration").
    - Movement: Low rolls (1-6) obstacles (e.g., "A spectral barrier pulses, whispering warnings of lost souls"), mid rolls (7-14) neutral (e.g., "Enters a dim chamber, shadows flickering with echoes of the past"), high rolls (15-20) new details (e.g., "Discovers an alcove etched with glowing sigils that hum with ancient power").
    - ObjectInteraction: Low rolls (1-6) fail (e.g., "The veilguard resists, burning the hand with a chilling curse"), mid rolls (7-14) partial success (e.g., "Reads a cryptic inscription on the cuirass, hinting at its origin"), high rolls (15-20) succeed (e.g., "Claims the dustwraith cuirass, its power resonating with the soul").
    - Combat: Low rolls (1-6) miss/take damage (e.g., "Strikes miss, wraith retaliates with chilling claws that sap strength"), mid rolls (7-14) minor hits (e.g., "Grazes the wraith with a faint spark of dark energy"), high rolls (15-20) succeed (e.g., "Channels necromantic power, wounding the wraith deeply").
    Outcomes must prioritize the player’s action, be unique to each character’s role and motivations, and advance the Mortacia plot with lore fragments or dilemmas. If the room is exhausted and the action is Search or PuzzleSolving, generate non-discovery outcomes (e.g., "The shadows yield only echoes of a forsaken past"). For Movement, describe the destination vividly with underworld elements. For PuzzleSolving, if the input matches the puzzle solution, set success to 95+% (rolls 2-20). For Dialogue/ObjectInteraction, favor evocative information/discovery tied to the underworld. NPCs/monsters respond dynamically to the player’s action, reflecting their motivations and the underworld’s atmosphere. Ensure exactly 3-6 outcomes per character, covering 1-20 with no gaps or overlaps. Provide all outcomes in this single response.`;

  const outcomesResponse = await $.assistant.generation();
  let outcomesData = (outcomesResponse.content || "").trim();
  console.log("Raw LLM outcomes response:", outcomesData);

  const normalizeCharacterName = (name) => name.replace(/[*"'`]/g, "").trim();
  selectedCharacters.forEach((character) => {
    const normalizedCharacter = normalizeCharacterName(character);
    const escapedCharacter = normalizedCharacter.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
    const regex = new RegExp(`-\\s*["'*]*${escapedCharacter}["'*]*:?`, "gi");
    outcomesData = outcomesData.replace(regex, `- "${character}":`);
  });
  console.log("Normalized outcomes data:", outcomesData);

  selectedCharacters.forEach((character, index) => {
    const characterOutcomes = [];
    const regex = new RegExp(`-\\s*"${character}":\\s*((?:\\d+\\.\\s*Dice roll range \\d+-\\d+:.*?(?:\\n|$))*)`, "gm");
    const match = regex.exec(outcomesData);

    if (match) {
      const outcomeText = match[1].trim();
      const outcomeRegex = /(\d+)\.\s*Dice roll range (\d+)-(\d+):\s*([\s\S]*?)(?=\n\d+\.|$)/g;
      let outcomeMatch;
      while ((outcomeMatch = outcomeRegex.exec(outcomeText)) !== null) {
        const low = parseInt(outcomeMatch[2], 10);
        const high = parseInt(outcomeMatch[3], 10);
        const outcome = outcomeMatch[4].trim();
        if (low <= high && low >= 1 && high <= 20) characterOutcomes.push({ low, high, outcome });
      }

      const coveredRanges = characterOutcomes.reduce((acc, { low, high }) => {
        for (let i = low; i <= high; i++) acc.add(i);
        return acc;
      }, new Set());

      if (coveredRanges.size !== 20 || characterOutcomes.length < 3 || characterOutcomes.length > 6) {
        console.warn(`Invalid outcomes for ${character}: ${coveredRanges.size} covered, count=${characterOutcomes.length}.`);
        const validOutcomes = characterOutcomes.filter(o => o.low <= o.high && o.low >= 1 && o.high <= 20);
        characterOutcomes.length = 0;
        if (validOutcomes.length) characterOutcomes.push(...validOutcomes);

        const missing = [];
        for (let i = 1; i <= 20; i++) if (!coveredRanges.has(i)) missing.push(i);
        if (missing.length) {
          const targetCount = Math.max(3, Math.min(6, validOutcomes.length + Math.ceil(missing.length / 7)));
          const ranges = [];
          const chunk = Math.ceil(missing.length / (targetCount - validOutcomes.length));
          for (let i = 0; i < missing.length; i += chunk) {
            const slice = missing.slice(i, i + chunk);
            ranges.push({ low: slice[0], high: slice[slice.length - 1] });
          }
          ranges.forEach((range, idx) => {
            const outcome =
              action === "Dialogue" ? `${character} murmurs faintly, their words weaving cryptic threads of Tartarus’ lost lore.` :
              action === "Search" && !isExhausted ? `Probes the ${idx % 2 ? 'fractured stone' : 'shadowed alcoves'}, sensing a pulse of ${idx % 2 ? 'forgotten rites' : 'necromantic energy'}.` :
              action === "Search" ? `Searches the chamber, hearing only the whispers of Tartarus’ forsaken past.` :
              action === "PuzzleSolving" && !isExhausted ? `Fumbles with the ${idx % 2 ? 'relics' : 'runes'}, feeling a fleeting shift in the temple’s aura.` :
              action === "PuzzleSolving" ? `Studies the puzzle, its cryptic design unyielding to ${character}’s efforts.` :
              action === "Movement" ? `Pauses in a ${idx % 2 ? 'eerie chamber' : 'dim passage'}, sensing a hum of ancient power.` :
              action === "ObjectInteraction" ? `Examines the object, its ${idx % 2 ? 'cryptic inscription' : 'chilling aura'} hinting at hidden power.` :
              action === "Combat" ? `${idx % 2 ? 'Channels a spark' : 'Swings cautiously'}, barely stirring the enemy’s shadow.` :
              `${character} hesitates, the underworld’s weight pressing against their resolve.`;
            characterOutcomes.push({ low: range.low, high: range.high, outcome });
          });
        }
        if (characterOutcomes.length < 3) {
          characterOutcomes.push({ low: 1, high: 20, outcome: `${character} senses a fleeting shift in Tartarus’ breath.` });
        }
      }
    } else {
      // Fallback 3 outcomes
      characterOutcomes.push(
        { low: 1, high: 6, outcome: `${character} falters; the underworld bristles.` },
        { low: 7, high: 14, outcome: `${character} advances cautiously, gleaning little but shadow.` },
        { low: 15, high: 20, outcome: `${character} seizes an opening, momentum turning.` }
      );
    }

    outcomeRangesList.push(characterOutcomes);
  });

  // Roll and select
  selectedCharacters.forEach((character, index) => {
    const diceRoll = Math.floor(Math.random() * 20) + 1;
    const characterOutcomes = outcomeRangesList[index] || [];
    characterOutcomes.sort((a,b) => a.low - b.low);
    const selected = characterOutcomes.find(r => diceRoll >= r.low && diceRoll <= r.high);
    diceRolls.push({ character, roll: diceRoll });
    outcomes.push({ character, outcome: selected ? selected.outcome : `No outcome for ${character} at ${diceRoll}.` });
  });

  const initialOutcomes = {
    "Selected Characters": selectedCharacters,
    "Outcome Ranges": outcomeRangesList,
    "Dice Rolls": diceRolls,
    "Outcomes": outcomes,
    "Action": action
  };

  console.log("Generated Outcomes:", JSON.stringify(initialOutcomes, null, 2));
  return initialOutcomes;
}


async function generateAdditionalOutcomes($, initialOutcomes, updatedGameConsole, userInput, activeTask = null) {
  if (!updatedGameConsole) {
    console.warn("No game console state provided, using default or empty values.");
    updatedGameConsole = "";
  }

  // ---------- small utils ----------
  function parseOnlyJson(text, fallback) {
    try {
      let t = String(text || "").trim();
      if (t.startsWith("```json")) t = t.slice(7);
      if (t.endsWith("```")) t = t.slice(0, -3);
      return JSON.parse(t.trim());
    } catch { return fallback; }
  }
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Grab just the first comma-separated token per line as "name"
  function extractNamesFromBlock(blockText) {
    if (!blockText) return [];
    const names = [];
    const re = /^([^,\n]+)\s*,/gm;
    let m;
    while ((m = re.exec(blockText)) !== null) {
      const name = (m[1] || '').trim();
      if (name && !/^none$/i.test(name)) names.push(name);
    }
    return [...new Set(names)];
  }

  function parseInventoryLine(text) {
    const m = text.match(/^Inventory:\s*(.*)$/mi);
    if (!m) return [];
    const line = (m[1] || '').trim();
    if (!line || /^none$/i.test(line)) return [];
    return line.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function currentRoomKeyFromConsole(text) {
    const m = text.match(/Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
    return m ? `${m[1]},${m[2]},${m[3]}` : '0,0,0';
  }

  function getHpFromDbOrConsole(monsterName, roomDb, consoleText, placementKey) {
    const block = roomDb?.[placementKey]?.monsters?.consoleBlock || '';
    const src   = block || consoleText;
    const idx   = src.search(new RegExp(escapeRe(monsterName), 'i'));
    if (idx < 0) return null;
    const win   = src.slice(idx, idx + 800);
    const m     = /HP:\s*(-?\d+)/i.exec(win);
    return m ? parseInt(m[1], 10) : null;
  }

  function getHpAfterName(text, name) {
    const idx = text.search(new RegExp(escapeRe(name), 'i'));
    if (idx === -1) return null;
    const win = text.slice(idx, idx + 800);
    const m = /HP:\s*(-?\d+)/i.exec(win);
    return m ? parseInt(m[1], 10) : null;
  }

  function replaceHpAfterName(text, name, newHp) {
    const idx = text.search(new RegExp(escapeRe(name), 'i'));
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const win    = text.slice(idx, idx + 800);
    const after  = text.slice(idx + 800);
    const replacedWin = win.replace(/HP:\s*\d+/i, `HP: ${newHp}`);
    return before + replacedWin + after;
  }

  // Hard prereq check (no side effects)
  function checkTaskPrereqs(activeTask, roomDb, consoleText, currentRoomKey) {
    const inv = new Set(parseInventoryLine(consoleText).map(s => s.toLowerCase()));
    const hard = Array.isArray(activeTask?.hardRequirements) ? activeTask.hardRequirements : [];
    const reqFails = [];

    for (const r of hard) {
      const c = String(r?.check || '').toLowerCase();
      if (c === 'at_coords') {
        const need = String(r.value || '').trim();
        if (currentRoomKey !== need) reqFails.push(`Be at ${need}`);
      } else if (c === 'inventory_contains') {
        const item = (r.value || '').toString().toLowerCase();
        if (!inv.has(item)) reqFails.push(`Have "${r.value}" in Inventory`);
      } else if (c === 'monster_hp_zero') {
        const mon = (r.value || '').toString();
        const placement = (activeTask?.requiredElements || []).find(e => e.type === 'monster' && e.name === mon)?.placement || currentRoomKey;
        const hp = getHpFromDbOrConsole(mon, roomDb, consoleText, placement);
        if (!(typeof hp === 'number' && hp <= 0)) reqFails.push(`${mon} HP must be 0`);
      }
    }
    return { prereqsMet: reqFails.length === 0, prereqFailures: reqFails };
  }

  // ---------- parse console ----------
  const roomNameMatch   = updatedGameConsole.match(/Room Name: ([^\n]+)/);
  const roomName        = roomNameMatch ? roomNameMatch[1].trim() : "Unknown Room";
  const pcDetails       = updatedGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/)?.[1]?.trim();
  const npcsDetails     = updatedGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
  const monstersDetails = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Objects in Room|Rooms Visited))/)?.[1]?.trim();
  const objectsInRoomMatch = updatedGameConsole.match(/Objects in Room: ([^\n]+)/);
  const roomExitsMatch     = updatedGameConsole.match(/Exits: ([^\n]+)/);

  const pcs       = pcDetails       ? extractNamesFromBlock(pcDetails)       : [];
  const npcs      = npcsDetails     ? extractNamesFromBlock(npcsDetails)     : [];
  const monsters  = monstersDetails ? extractNamesFromBlock(monstersDetails) : [];
  const currentObjects = objectsInRoomMatch ? objectsInRoomMatch[1].split(", ").map((o) => o.trim()) : [];
  const currentExits   = roomExitsMatch ? roomExitsMatch[1].split(", ").map((e) => e.trim()) : [];

  const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
  const currentCoordinates = currentCoordinatesMatch
    ? { x: parseInt(currentCoordinatesMatch[1]), y: parseInt(currentCoordinatesMatch[2]), z: parseInt(currentCoordinatesMatch[3]) }
    : { x: 0, y: 0, z: 0 };
  const coordKey = `${currentCoordinates.x},${currentCoordinates.y},${currentCoordinates.z}`;

  // Pull action from initial outcomes
  const action = String(initialOutcomes?.Action || initialOutcomes?.action || 'Unknown');

  // ---------- init accumulators ----------
  let new_objects = [];
  let new_exit = "";
  let xp_awarded = {};
  let trap_damage = {};
  let object_modifiers = {};
  let new_adjacent_room = {};
  let coordinates_of_connected_rooms = {};

  // ---------- active task context & questAttempted ----------
  const activeTaskJson = activeTask ? JSON.stringify({
    type: activeTask.type,
    actionKind: activeTask.actionKind,
    desc: activeTask.desc,
    metrics: activeTask.metrics,
    requiredElements: activeTask.requiredElements || []
  }) : "{}";

  $.model = "gpt-4.1-mini";
  $.temperature = 1.0;
  const TRUE_FALSE = ["true", "false"];

  await $.user`Given the player input "${userInput}", the initial outcomes (dice + narrative), and ACTIVE QUEST TASK CONTEXT ${activeTaskJson}:
Is the player clearly attempting to complete the active quest step right now?
Respond ONLY {"questAttempted":"X"} with X ∈ {"true","false"}.`;

  const qaResp = await $.assistant.generation({
    parameters: { questAttempted: { type: String, enum: TRUE_FALSE } }
  });

  let questAttempted = String(
    (parseOnlyJson(qaResp.content, { questAttempted: "false" }) || {}).questAttempted
  ).toLowerCase() === "true";
  console.log("questAttempted:", questAttempted);

  // ---------- room DB & prereqs ----------
  let roomNameDatabasePlain = {};
  try { roomNameDatabasePlain = JSON.parse(sharedState.getRoomNameDatabase() || "{}"); }
  catch { roomNameDatabasePlain = {}; }

  const { prereqsMet } = activeTask
    ? checkTaskPrereqs(activeTask, roomNameDatabasePlain, updatedGameConsole, coordKey)
    : { prereqsMet: false };

  // ---------- outcomes intent booleans ----------
  const serializedInitialOutcomes = JSON.stringify(initialOutcomes, null, 2);

  $.model = "gpt-4.1-mini";
  $.temperature = 1.0;
  await $.user`Here are the current outcomes of actions by the PC, NPCs and monsters in the room:
${serializedInitialOutcomes}
Store this information in memory and await the next prompt`;

  await $.user`Based on the user input "${userInput}" and the game context, answer the following questions with true or false:
1. engagedInDialogue (True/False)
2. justLooking (True/False)
3. searchAttempted (True/False)
4. searchSuccessful (True/False)
5. objectDiscovered (True/False)
6. exitDiscovered (True/False)
7. puzzleRequiresExit (True/False)
8. puzzleRequiresObject (True/False)
Respond ONLY a JSON object with these exact keys.`;

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

  console.log(`Intent response (raw): ${JSON.stringify(intentResponse)}`);
  const respStr = intentResponse.content || String(intentResponse.result);

  let engagedInDialogue = false;
  let justLooking = false;
  let searchAttempted = false;
  let searchSuccessful = false;
  let objectDiscovered = false;
  let exitDiscovered = false;
  let puzzleRequiresExit = false;
  let puzzleRequiresObject = false;

  {
    const fb = respStr.indexOf('{');
    const lb = respStr.lastIndexOf('}');
    if (fb !== -1 && lb !== -1 && lb > fb) {
      try {
        const parsed = JSON.parse(respStr.slice(fb, lb + 1));
        engagedInDialogue  = !!parsed.engagedInDialogue;
        justLooking        = !!parsed.justLooking;
        searchAttempted    = !!parsed.searchAttempted;
        searchSuccessful   = !!parsed.searchSuccessful;
        objectDiscovered   = !!parsed.objectDiscovered;
        exitDiscovered     = !!parsed.exitDiscovered;
        puzzleRequiresExit = !!parsed.puzzleRequiresExit;
        puzzleRequiresObject = !!parsed.puzzleRequiresObject;
      } catch (e) {
        console.warn("Failed to parse intent JSON:", e);
      }
    }
  }

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

  // ---------- DB key migration + ensure start ----------
Object.keys(roomNameDatabasePlain).forEach(key => {
  if (key.startsWith('X:')) {
    const cleanKey = key
      .replace(/X:\s*|Y:\s*|Z:\s*/g, '')   // drop labels
      .replace(/,\s*/g, ',');              // normalize commas

    const legacy = roomNameDatabasePlain[key];
    const existing = roomNameDatabasePlain[cleanKey] || {};

    // Merge so that:
    // - Existing classification / isIndoor / isOutdoor / indoor win if present
    // - We still carry over base fields from legacy if missing
    const merged = {
      ...legacy,
      ...existing,
      classification: existing.classification || legacy.classification,
      isIndoor: (typeof existing.isIndoor === 'boolean')
        ? existing.isIndoor
        : legacy.isIndoor,
      isOutdoor: (typeof existing.isOutdoor === 'boolean')
        ? existing.isOutdoor
        : legacy.isOutdoor,
      indoor: (typeof existing.indoor === 'boolean')
        ? existing.indoor
        : legacy.indoor
    };

    roomNameDatabasePlain[cleanKey] = merged;
    delete roomNameDatabasePlain[key];
  }
});

// 2) Ensure we always have a defined starting room, and mark it indoor by default
if (!roomNameDatabasePlain['0,0,0']) {
  roomNameDatabasePlain['0,0,0'] = {
    name: "Ruined Temple Entrance",
    exhaustionLimit: 4,
    attemptedSearches: 0,
    trapTriggered: false,
    exits: {},
    objects: [],
    indoor: true,
    classification: { indoor: true },
    isIndoor: true,
    isOutdoor: false
  };
}

  // ---------- current room record ----------
/*  let currentRoomData = roomNameDatabasePlain[coordKey] || {};
  currentRoomData = {
    name: roomName,
    exhaustionLimit: currentRoomData.exhaustionLimit ?? 4,
    attemptedSearches: currentRoomData.attemptedSearches ?? 0,
    trapTriggered: currentRoomData.trapTriggered ?? false
  };*/
  
  // ---------- current room record ----------
// IMPORTANT: do NOT overwrite the whole object; that would nuke
// classification, indoor/outdoor flags, exits, objects, etc.
let currentRoomData = roomNameDatabasePlain[coordKey] || {};

// Keep the existing name if we somehow don't have one from the console
currentRoomData.name = roomName || currentRoomData.name || "Unknown";

// Preserve existing fields; only fill in defaults where missing
if (typeof currentRoomData.exhaustionLimit !== "number") {
  currentRoomData.exhaustionLimit = 4;
}
if (typeof currentRoomData.attemptedSearches !== "number") {
  currentRoomData.attemptedSearches = 0;
}
if (typeof currentRoomData.trapTriggered !== "boolean") {
  currentRoomData.trapTriggered = false;
}



  // ---------- quest tie-in + exhaustion ----------
  // If player attempted quest but prereqs not met: force a failed attempt
  if (activeTask && questAttempted && !prereqsMet) {
    searchAttempted = true;
    searchSuccessful = false;
  }

  let exhausted = currentRoomData.attemptedSearches >= currentRoomData.exhaustionLimit;
  let reason = exhausted ? "The room has been thoroughly searched; no new discoveries are made." : "";

  // If a puzzle-ish quest was attempted and succeeded, mark success
  let questSucceeded = false;
  if (activeTask && questAttempted && prereqsMet) {
    const kind = (activeTask.actionKind || "").toLowerCase();
    if ((kind === "solve_puzzle" || (activeTask.type || "").toLowerCase() === "puzzle" || kind === "investigate")
        && searchAttempted && searchSuccessful) {
      questSucceeded = true;
    }
  }

  if (questSucceeded) {
    currentRoomData.attemptedSearches = currentRoomData.exhaustionLimit;
    exhausted = true;
    reason = "The puzzle tied to the quest was solved; the room yields no further discoveries.";
  } else if (searchSuccessful && action === "PuzzleSolving") {
    currentRoomData.attemptedSearches = currentRoomData.exhaustionLimit;
    exhausted = true;
    reason = "The room’s puzzle was solved; it is now exhausted.";
  }

  // ---------- explicit discoveries override ----------
  if (objectDiscovered || exitDiscovered) {
    searchAttempted = true;
    searchSuccessful = true;
    engagedInDialogue = false;
    justLooking = false;
  }

  // ---------- early return if dialogue/looking ----------
  if (engagedInDialogue || justLooking) {
    console.log("Player is in dialogue or just looking; skipping additional outcomes generation.");
    // Persist DB state before return
    roomNameDatabasePlain[coordKey] = currentRoomData;
    sharedState.setRoomNameDatabase(JSON.stringify(roomNameDatabasePlain));
    return {
      new_objects,
      object_modifiers,
      new_exit,
      new_adjacent_room,
      coordinates_of_connected_rooms,
      xp_awarded,
      trap_damage,
      exhausted,
      reason,
      questAttempted,
      questSucceeded,
      prereqsMet
    };
  }

  // ---------- discovery / traps ----------
  const kind = (activeTask?.actionKind || "").toLowerCase();
  const isSearchOrPuzzleContext =
    action === "PuzzleSolving" || action === "Search" || kind === "solve_puzzle" || kind === "investigate";

  // Force traps to 100% ONLY when the player is actually attempting search/puzzle and that attempt did NOT succeed.
  const forceTrap = isSearchOrPuzzleContext && searchAttempted && !searchSuccessful;

  let objectToBeDiscovered = !exhausted && (objectDiscovered || (searchSuccessful && Math.random() < 0.4));
  let exitToBeDiscovered   = !exhausted && (exitDiscovered   || (searchSuccessful && Math.random() < 0.2));
  const trapsPresent       = !exhausted && !currentRoomData.trapTriggered && forceTrap;

  console.log("Discovery Checks:", {
    objectToBeDiscovered,
    exitToBeDiscovered,
    trapsPresent,
  });

  // ---------- XP for discoveries ----------
  if ((objectToBeDiscovered || exitToBeDiscovered) && !exhausted) {
    const xpEligibleCharacters = [...pcs, ...npcs];
    await $.user`For the following characters: ${xpEligibleCharacters.join(", ")}, assign XP for discovering new objects or exits in the room. Award up to 500 XP to each character who contributed to the discovery, based on the initial outcomes: ${serializedInitialOutcomes}. Respond with a JSON object mapping character names to their XP but do not include the word json, just the object, to avoid syntax errors.`;
    const xpResponse = await $.assistant.generation();
    try { xp_awarded = JSON.parse((xpResponse.content || "{}").trim()); }
    catch { xp_awarded = {}; }
    console.log("XP awarded for discoveries:", xp_awarded);
  }

  // ---------- object generation ----------
  if (objectToBeDiscovered) {
    await $.user`Based on the outcomes of actions, respond with ONLY the JSON object in the format: {"count": N} where N is the number of objects discovered (an integer). No explanations, comments, or text before or after the JSON.`;
    const objectCountResponse = await $.assistant.generation();
    const countStr = objectCountResponse.content || String(objectCountResponse.result || "");
    let numberOfObjects = 1;
    {
      const fb = countStr.indexOf("{"), lb = countStr.lastIndexOf("}");
      if (fb !== -1 && lb !== -1 && lb > fb) {
        try {
          const parsed = JSON.parse(countStr.slice(fb, lb + 1));
          numberOfObjects = Number.isInteger(parsed.count) ? parsed.count : 1;
        } catch {}
      } else {
        const n = parseInt(countStr.trim(), 10);
        numberOfObjects = Number.isNaN(n) ? 1 : n;
      }
    }
    for (let i = 0; i < numberOfObjects; i++) {
      await $.user`Generate a name for a portable object suitable for a fantasy roleplaying game, as described in the outcomes of actions. Respond with ONLY the JSON object in the format: {"name": "X"} where X is the lowercased object name (single-line text without punctuation, fitting the game's narrative). No explanations, comments, or text before or after the JSON.`;
      const nameResponse = await $.assistant.generation();
      const nameStr = nameResponse.content || String(nameResponse.result || "");
      let objectName = "unknown object";
      {
        const fb = nameStr.indexOf("{"), lb = nameStr.lastIndexOf("}");
        if (fb !== -1 && lb !== -1 && lb > fb) {
          try {
            const parsed = JSON.parse(nameStr.slice(fb, lb + 1));
            if (parsed.name) objectName = String(parsed.name).trim().toLowerCase();
          } catch {}
        }
      }
      $.model = "gpt-4.1-mini";
      $.temperature = 1.0;
      await $.user`Determine the type of the artifact named "${objectName}". Respond with ONLY the JSON object in the format: {"type": "X"} where X is one of "weapon", "armor", "shield", or "other". No explanations, comments, or text before or after the JSON.`;
      const typeResponse = await $.assistant.generation({
        parameters: { type: { type: String, enum: ["weapon","armor","shield","other"] } }
      });
      const typeStr = typeResponse.content || String(typeResponse.result || "");
      let objectType = "other";
      {
        const fb = typeStr.indexOf("{"), lb = typeStr.lastIndexOf("}");
        if (fb !== -1 && lb !== -1 && lb > fb) {
          try {
            const parsed = JSON.parse(typeStr.slice(fb, lb + 1));
            if (parsed.type) objectType = parsed.type;
          } catch {}
        }
      }
      const modifiers = await generateObjectModifiers($, { name: objectName, type: objectType });
      new_objects.push(objectName);
      object_modifiers[objectName] = { type: objectType, ...modifiers };
    }
  }

  // ---------- exit generation ----------
  if (exitToBeDiscovered) {
    await $.user`Generate a unique room name for a room connected to "${roomName}", considering the conversation history, current location, coordinates in the game console, previous locations in the maze, and the game's lore. Respond with ONLY {"name":"X"} where X is lowercased, single-line, no punctuation.`;
    const roomNameResponse = await $.assistant.generation();
    const rnStr = roomNameResponse.content || String(roomNameResponse.result || "");
    let newRoomName = "unknown chamber";
    {
      const fb = rnStr.indexOf("{"), lb = rnStr.lastIndexOf("}");
      if (fb !== -1 && lb !== -1 && lb > fb) {
        try {
          const parsed = JSON.parse(rnStr.slice(fb, lb + 1));
          if (parsed.name) newRoomName = String(parsed.name).trim().toLowerCase();
        } catch {}
      }
    }
    if (newRoomName) {
      const possibleExits = ["north","south","east","west","northeast","southeast","northwest","southwest","up","down"];
      for (const exit of possibleExits) {
        if (!currentExits.includes(exit)) {
          new_exit = exit;
          const directionMap = {
            north: { x: 0, y: 1, z: 0 }, south: { x: 0, y: -1, z: 0 },
            east:  { x: 1, y: 0, z: 0 }, west:  { x: -1, y: 0, z: 0 },
            northeast: { x: 1, y: 1, z: 0 }, southeast: { x: 1, y: -1, z: 0 },
            northwest: { x: -1, y: 1, z: 0 }, southwest: { x: -1, y: -1, z: 0 },
            up: { x: 0, y: 0, z: 1 }, down: { x: 0, y: 0, z: -1 }
          };
          const delta = directionMap[exit];
          coordinates_of_connected_rooms = {
            x: currentCoordinates.x + delta.x,
            y: currentCoordinates.y + delta.y,
            z: currentCoordinates.z + delta.z,
          };
          new_adjacent_room = { name: newRoomName, description: `A newly discovered room to the ${exit}.` };
          break;
        }
      }
    }
  }

  // If any discovery happened, exhaust the room
  if ((new_objects.length || new_exit) && !exhausted) {
    currentRoomData.attemptedSearches = currentRoomData.exhaustionLimit;
    exhausted = true;
    reason = "A new discovery was made; the room is now fully exhausted.";
  }

  // ---------- traps (apply to PCs+NPCs, names only) ----------
  if (trapsPresent) {
    currentRoomData.trapTriggered = true;
    const charactersToDamage = [...pcs, ...npcs];
    console.log(`Characters to damage: ${JSON.stringify(charactersToDamage)}`);
    for (const name of charactersToDamage) {
      const dmg    = Math.floor(Math.random() * 7) + 1; // 1..7
      const currHp = getHpAfterName(updatedGameConsole, name);
      const newHp  = Math.max(0, (typeof currHp === 'number' ? currHp : 0) - dmg);
      updatedGameConsole = replaceHpAfterName(updatedGameConsole, name, newHp);
      trap_damage[name] = (trap_damage[name] || 0) + dmg;
      console.log(`Applied ${dmg} trap damage to ${name}; HP ${currHp ?? '??'} -> ${newHp}`);
    }
  }

  // ---------- additional XP if not exhausted ----------
  if (!exhausted) {
    const xpEligibleCharacters = [...pcs, ...npcs];
    await $.user`For the following characters: ${xpEligibleCharacters.join(", ")}, decide which characters deserve XP based on their actions in the initial outcomes, excluding discovery-based XP already awarded, and assign up to 500 XP to each deserving character for non-discovery actions. Respond with a JSON object mapping character names to their XP but do not include the word json, just the object, to avoid syntax errors.`;
    const xpResponse = await $.assistant.generation();
    let additionalXp = {};
    try { additionalXp = JSON.parse((xpResponse.content || "{}").trim()); } catch {}
    for (const [ch, xp] of Object.entries(additionalXp)) {
      xp_awarded[ch] = (xp_awarded[ch] || 0) + (xp || 0);
    }
    console.log("Additional XP awarded for non-discovery actions:", additionalXp);
  } else {
    console.log("Room is exhausted; no additional XP awarded.");
  }

  // ---------- persist & return ----------
  roomNameDatabasePlain[coordKey] = currentRoomData;
  sharedState.setRoomNameDatabase(JSON.stringify(roomNameDatabasePlain));
  sharedState.setUpdatedGameConsole?.(updatedGameConsole);

  const result = {
    new_objects,
    object_modifiers,
    new_exit,
    new_adjacent_room,
    coordinates_of_connected_rooms,
    xp_awarded,
    trap_damage,
    exhausted,
    reason,
    questAttempted,
    questSucceeded,
    prereqsMet
  };
  console.log("Generated Additional Outcomes:", JSON.stringify(result, null, 2));
  return result;
}


// LLM-only gate: decide if dice-y adjudication should run for this user input
async function shouldRunAdjudication($, userInput, updatedGameConsole) {
  const consoleExcerpt = (updatedGameConsole || "").slice(0, 1500);

  $.model = "gpt-4.1-mini";
  $.temperature = 0.0;

  // Clear definitions + lots of labeled examples so GPT can generalize without regex.
  await $.user`
You are a game arbiter. Classify the player's latest input by setting booleans.
Return ONLY JSON with the keys specified below—no prose.

### Definitions
- engagedInDialogue: true if the player is *talking* (chatting, asking lore questions, social small talk)
  that does **not** directly attempt a puzzle step or command actions. Example: "say hello", "ask the priest about the relic".
- justLooking: true if the player is simply observing or inquiring about room details without *doing*;
  e.g., looking/reading/deciphering/listening/inspecting *without* performing a step of a puzzle.
  Example: "what do the runes say?", "examine altar", "read the book", "listen at the door".
- commandToNPCs: true if the player tells NPCs/party to perform actions. Example: "Thalia, search the alcove",
  "Order the mercenary to pick the lock", "Have the party move the statue".
- physicalAction: true if the player performs a concrete action that could need a check/roll:
  searching, lifting, forcing, climbing, breaking, sneaking, disarming, picking a lock, clearing rubble,
  moving heavy things, etc. (Not simple movement like 'north', and not trivial inventory ops.)
- puzzleAction: true if the player attempts a *step* toward solving a riddle/mechanism/sequence
  (turning dials, placing sigils, speaking a required incantation as part of a solution,
  aligning mirrors, setting stones in a pattern, etc.).
- deterministicCommand: true for routine commands that should not trigger dice:
  simple movement (e.g., "north", "down"), simple door open/unlock with a known key phrase
  (e.g., "open door with bone key"), inventory management ("take torch", "equip sword"),
  or UI-driven selections. These are handled elsewhere without simulation.

### Important rule
- If the spoken words are an explicit step required by the puzzle (e.g., a pass-phrase),
  set puzzleAction=true and engagedInDialogue=false.

### Examples (→ expected flags)
1) "say hello to the guardian"
   engagedInDialogue=true, justLooking=false, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=false
2) "what do the runes say?"
   engagedInDialogue=false, justLooking=true, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=false
3) "examine the altar closely"
   engagedInDialogue=false, justLooking=true, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=false
4) "read the black tome on the lectern"
   engagedInDialogue=false, justLooking=true, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=false
5) "recite 'Valus Nareth' to open the seal"  // required incantation for the puzzle
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=false, puzzleAction=true, deterministicCommand=false
6) "search the room for hidden compartments"
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=true, puzzleAction=false, deterministicCommand=false
7) "force the door with the crowbar"
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=true, puzzleAction=false, deterministicCommand=false
8) "align the mirrors to direct the beam"
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=false, puzzleAction=true, deterministicCommand=false
9) "Thalia, check the western alcove; Orren, lift the lid"
   engagedInDialogue=false, justLooking=false, commandToNPCs=true, physicalAction=false, puzzleAction=false, deterministicCommand=false
10) "order the mercenary to pick the lock"
   engagedInDialogue=false, justLooking=false, commandToNPCs=true, physicalAction=false, puzzleAction=false, deterministicCommand=false
11) "north"
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=true
12) "open door with bone key"
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=true
13) "take the torch"
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=true
14) "equip iron shield"
   engagedInDialogue=false, justLooking=false, commandToNPCs=false, physicalAction=false, puzzleAction=false, deterministicCommand=true

Player input: "${userInput}"
Game console excerpt:
${consoleExcerpt}

Return ONLY JSON with keys:
{"engagedInDialogue":bool,"justLooking":bool,"commandToNPCs":bool,"physicalAction":bool,"puzzleAction":bool,"deterministicCommand":bool}
`;

  const intentResponse = await $.assistant.generation({
    parameters: {
      engagedInDialogue:   { type: Boolean },
      justLooking:         { type: Boolean },
      commandToNPCs:       { type: Boolean },
      physicalAction:      { type: Boolean },
      puzzleAction:        { type: Boolean },
      deterministicCommand:{ type: Boolean }
    }
  });

  // Robust JSON extraction (same pattern you use elsewhere)
  const raw = intentResponse.content || String(intentResponse.result || "");
  const firstBrace = raw.indexOf("{");
  const lastBrace  = raw.lastIndexOf("}");
  let parsed = {};
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try { parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)); }
    catch (e) { console.warn("shouldRunAdjudication: JSON parse failed", e); }
  }

  const {
    engagedInDialogue = false,
    justLooking = false,
    commandToNPCs = false,
    physicalAction = false,
    puzzleAction = false,
    deterministicCommand = false
  } = parsed;

  const runSimulation =
    !deterministicCommand &&
    (commandToNPCs || physicalAction || puzzleAction) &&
    !(engagedInDialogue || justLooking);

  return {
    runSimulation,
    flags: { engagedInDialogue, justLooking, commandToNPCs, physicalAction, puzzleAction, deterministicCommand }
  };
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

    $.model = "gpt-4.1-mini";
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

async function adjudicateActionWithSimulation($, userInput, updatedGameConsole, activeTask = null, maxRetries = 3, delayMs = 1000) {
  if (!activeTask) {
    const tasks = sharedState.getCurrentTasks?.() || [];
    const idx   = sharedState.getCurrentTaskIndex?.() || 0;
    activeTask  = tasks[idx] || null;
  }
    let attempt = 0;
    let initialOutcomes = null;

    while (attempt < maxRetries) {
        try {
            console.log(`Adjudication Process Attempt: ${attempt + 1}/${maxRetries}`);
            console.log("User Input:", userInput);
            console.log("Initial Game Console State:", updatedGameConsole);

            // Step 1: Generate initial outcomes
            console.log("Generating outcomes...");
            const outcomesResult = await generateOutcomes($, userInput, updatedGameConsole, activeTask);

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
            const additionalOutcomes = await generateAdditionalOutcomes($, outcomesResult, updatedGameConsole, userInput, activeTask);

            console.log("Generated Additional Outcomes:", additionalOutcomes);

            // Step 3: Update the game console using `processGameUpdate`
            console.log("Updating Game Console...");
            const gameUpdateResult = processGameUpdate(additionalOutcomes, updatedGameConsole);
            console.log("Updated Game Console:", gameUpdateResult);

            // Step 4: Generate the narrative
            console.log("Generating Narrative...");
            const narrative = generateNarrative(initialOutcomes, additionalOutcomes, userInput);
            console.log("Generated Narrative:", narrative);
            
            if (typeof sharedState.setLastAdjudication === 'function') {
                sharedState.setLastAdjudication({
                  roomKey: (updatedGameConsole.match(/Coordinates: X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/) || []).slice(1,4).join(','),
                  questAttempted: !!additionalOutcomes.questAttempted,
                  questSucceeded: !!additionalOutcomes.questSucceeded,
                  prereqsMet: !!additionalOutcomes.prereqsMet,
                  actionKind: activeTask?.actionKind || null,
                  taskType: activeTask?.type || null
                });
              }

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
    $.model = "gpt-4.1-mini";
    $.temperature = 1.2;
//    await $.run($ => generateMissingRoomDetails($)); 
    await $.run($ => generateQuest($));
            $.model = "gpt-4.1-mini";
            $.temperature = 1.2;
            $.user`Instructions for the Grave Master:
            
            Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console and the die rolls, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go including imagining the names and histories of people, places and things encountered, but you must allow me, the player, to type the commands, allowing for potential failure. Make it strange, unusual and as thought-provoking as possible. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game, while the Grave Master controls monsters and NPCs. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. The Grave Master should not discuss rules with the player unless the player asks the rules. The Grave Master's job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. If any later instruction conflicts with this block, the later instruction overrides. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading either outdoors into the wastelands of Tartarus or deeper into the temple, ultimately leading to the 1000th room, the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console below and using unique characters, plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. The monsters and NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn. The Grave Master should use this as inspiration: 'You have died and find yourself standing in the the first room in the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.'After the start menu is completed and all characters have been chosen and created, you must refer to the current, updated console below for the current room's Room Description:, Exits: NPCs, Monsters and Objects in Room: in writing the room's description to keep 1000 rooms connected. Proceed with the game when I have made my selections from the start menu of either Mortacia, goddess of death, Mortacia is (an 8 1/2 tall human-looking female with long blonde hair, large grey dragon wings that look slightly decayed with many holes and openings and can fly but not too far, and is on a quest to reclaim the Sepulchra to reclaim her throne in Hades, Suzerain, Knight of Atinus, the recurring hero of the Children of the Grave campaign setting who keeps having to save the world, die and go to the afterlife, raise an army of the dead souls to save the underworld plane of Hades from Arithus, and then be reborn again, who has just died and finds himself in the first room of the afterlife, or an adventuring party of seven adventurers named the Children of the Grave who have died and find themselves in the first room of the afterlife and been summoned by Mortacia, but who are unaware of their circumstances at first: 1 PC whom I direct, 5 NPCs you control and also Mortacia, who is also an NPC you control and joins the party, described herein, all the characters described herein have been created and I am in the Ruined Temple in Tartarus described herein and issued the command to proceed. Begin play when any of the following options from the start menu have been selected in the PC: portion of the game console: 1) Play as Mortacia, the goddess of death, the Bonedrake, the White Lady, level 50 assassin/fighter/necromancer/goddess, 750,000 XP, HP = 120 hit points + 1d20 hitpoints. 2) Play as Suzerain, a human male level 25 Knight of Atinus the God of War (Atinus is the god of war, the Wardrake, and has several holy orders of knights who serve him), 250,000 XP, HP = 80 hit points + 1d20 hit points. 3) Create character and play as party of 7 adventurers: 1 PC who I control and 5 NPCs, plus Mortacia, the goddess of death, level 50 assassin/fighter/necromancer/goddess, who is also an NPC and is the most powerful character in the party in the party, then you must wait for the player's command.  Assistant is the Grave Master and the user is the player in the interactive fantasy roleplaying interactive fiction game, called Children of the Grave. The Grave Master administers the game. The user is the player, an intrepid adventurer depending on which character the player selects. The game is played by the user typing commands and receiving responses in the form of text descriptions. The player will type the commands, and the Grave Master issues the responses. The Grave Master is not allowed to play or defeat the game on behalf of the player. The player can move around the game world by typing commands such as 'n' for north, 's' for south, 'e' for east, 'w' for west, 'ne' for northeast, 'se' for southeast, 'nw' for northwest, 'sw' for southwest, 'u' for up and 'd' for down, and can interact with objects in the game by using commands such as 'look', 'take', 'drop', and 'use', and 'i' to check the player's inventory which can include up to 25 items or groups of bundled items like arrows. The player starts out the game with no weapons (they must be acquired). Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. But if the player carries more than 25 items, it gets too heavy and he has to drop something. Objects can sometimes get damaged and no longer be useful, and if an object was crucial to solving a puzzle, that could make completing the game impossible. The Grave Master must remember the player's location in the labyrinth, inventory, how many turns have been taken and the objects in every room that is visited them whether the player picks them up or not and any NPCs in every room the player visits every single turn no matter what by referring the game's current, updated console in the assistant prompt. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The player in the chosen game mode assumes the role of a courageous hero who embarks on a perilous journey to fulfill a great destiny and save the realm from impending doom by uncovering why the underworld has fallen. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room has a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describes the environment, objects and NPCs in each room. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. NPCs should often talk to the player and to other NPCs. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including animals, persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs are unique individuals with biases/emotions/backstories, creating a varied and dynamic gameplay experience. NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. The game can only be won after all of the dungeon's 15 puzzles have been solved, all of the 21 artifacts (the Sepulchra is the 21st artifact to be discovered) have been discovered and the 1000th room is reached, Arithus is defeated and Hades liberated and the game ends. The game must keep a score out of 1000 possible points. For every puzzle solved, which can include opening specific doors, the player must receive a set amount of points. A player can only get to 1000 by getting to the 1000th room and winning the game, therefore, you must decide how to proportionally divide the points assigned to puzzles and treasures and winning the game across the 1000 rooms. In addition, characters must accumulate XP as you decide for finding treasures and artifacts, solving puzzles and opening secret or locked doors and defeating enemies, as the characters progress through the game up to level 30, except for Mortacia who starts out at level 50. ...  

Summary: You are the Grave Master, administering this interactive fiction adventure game titled Children of the Grave. 'You' refers to the Grave Master (the AI assistant). 'Me', 'I', or 'the player' refers to the user. Your role is to oversee the game, describe the world, control NPCs and monsters, and respond to player commands while maintaining immersion. You must follow these instructions precisely without improvisation, ensuring the game remains consistent, engaging, and adherent to the rules.
1. Core Game Principles
1.1 Game Format and Interaction: This is an AI-generated fantasy roleplaying interactive fiction game. Make up the story dynamically, integrating real-time information from the Current Game Console (provided in assistant prompts). Allow only the player to input commands (e.g., directions like 'n' for north, interactions like 'look', 'take', 'drop', 'use', 'i' for inventory). Never act, decide, or complete actions on the player's behalf. Obey player commands exactly, allowing for potential failure based on logic, die rolls, or context.
1.2 Immersion and Restrictions: Maintain RPG immersion using text descriptions only—no asterisks, rules discussions (unless asked), or breaking character. Do not display the game console or backend mechanics. Focus on strange, unusual, thought-provoking elements. 
1.3 Player Agency: The player controls their character(s) and makes all decisions. You control NPCs (with free will/agency) and monsters (hostile, friendly, or neutral, with motivations/backstories). Include NPC/monster actions, dialogues (in quotes), and thoughts/opinions in responses. Resolve their actions via die rolls where applicable.
2. World and Lore Integration
2.1 Setting Overview: The game begins in the Ruined Temple in Tartarus, an underworld plane—a vast wasteland with yellowish skies, mountains, sandstorms, dark magics, monsters, dragons, angels, demons, and entities of pure energy. The story revolves around Mortacia's loss of power, the undead rising due to Dantuea, and Hades falling to Arithus. Uncover clues about this chaos through room elements, creating specific lore (names, histories) but NPCs and monsters are individuals with free will and agency, are subject to their own emotions and biases, have unique personalities and character traits, and draw from original, well-developed backstories and experiences, possessing limited but also specialized knowledge (expert in some areas, novice in others), thereby expressing certainty in some instances but confusion in others, getting it wrong sometimes and can have disagreements.
2.2 Central Narrative: The player embarks on a hero's journey to restore balance. Key elements include 15 quests (central or side, involving monsters/artifacts), 21 artifacts (guarded, often by monsters; Sepulchra is the 21st), and progression to the 1000th room (Throne Room in Hades) to defeat Arithus. Quests advance the narrative, starting with an initial one and culminating in confronting Arithus after all artifacts are found.
2.3 Backstory Utilization: Draw from provided lore (e.g., Tome of the Twelve creation myth, Dragon Wars, deities' histories). Time dilation: 30 surface years = 3 underworld years. Integrate deities as NPCs or references in art/statues. Create motivations for deities' machinations (good, evil, balance). Finding the Tome of the Twelve is the 10th artifact.
2.4.1 Deities List: The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure. Use these as NPCs/references with created motivations:

Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)
2.4.2 Lore

The following is some backstory that you must consider when crafting the adventure in Tartarus and Hades: The greatest looming threat to the safety of the races and the world at large is the tragic Sepulture that will take place 29 years into the future (928 Surface Reckoning) in which the Rakshasa of Darkwood will summon the fiery lavas (the Earthdragon’s blood) from the volcano Utza in a bizarre mass ritual and then teleport the terrible firestorm to the city-state of Aten in an effort to wipe out the chosen champions of the deities.  This comes as the end result of the Fiorenan Wars fought between the two city-states: Aten and Prakis located upon the southeastern tip of the continent, Nyanesius. Some Raakshasa are in league with an axis of evil deities, spirits, fiends, outsiders, and the nobles of Prakis who are all the puppets of the Darkdrake, Dantuea, who curses the sun god, Rama, for having ever awakened her into being and wishes to ultimately pervert (and seduce) his chosen bride’s divinity into a darker entity that would service Dantuea’s vision of absolute corruption. The vast pantheon of deities is draconic in origin (i.e. the races worship dragons). The greater deities are celestial bodies such as planets.  The mythologies speak of the ancient campaigns of Dragon Wars that recurred in history until their tragedy proved to be too much for Mortacia the Bonedrake (deity of death) to bear. Descriptions and histories of these classes and character ideas are contained herein including histories and locations of the world of Danae and the continent of Nyanesius, which contains the Nyanesian Empire which wars with the Dartotian nobles of the island kingdom of Dracontage and in the southeastern part of the continent, on the Fiorenan Peninsula, where Aten, a democratic city-state, wars with Prakis, ruled by Dartotian-allied nobles called the Nowells and are currently ruled by High Lord Varius Nowell who is plotting to subvert republican rule in Aten that he fears will wash over the noble ruling familes and aristocracy. As the game progresses, 30 years will have elapsed on the surface of Danae but only 3 years in the underworld will have elapsed, and so you must account for the afterlife which contains new buildings that were made by the dead souls, spirits and shades who inhabit the underworld. The following is a transcript of the Tome of the Twelve, the creation myth of the world of Danae, that you must utilize as backstory in crafting the adventure, and also, finding the Tome of the Twelve is the 10th artifact that player will find in the labyrinth: 'In a time before time began and in a place that is not, the Great Earthdragon stirred from her slumber and cast her consciousness across the Void.  Long she searched, and ever in vain, until one answered her call.  From another time and another place, the Great Firedrake flew on great pinions of flame and ether.  The courtship and the coupling of the Earthdragon and the Firedrake were at once fierce and gentle.  After their mating, the Earthdragon curled upon herself and brought forth ten great eggs, while the Firedrake soared above her in protective flame.  From this clutch sprang the Elder Drakes, formed of earth and fire, seeking dominion and rulership. Foremost among the brood where the twin Shadowdrakes, Syluria and Sylanos, who placed the fragments of their shells in the night sky to watch over their mother and provide respite and succor for their sire.  Thus was the Great Firedrake able to rest while the twin orbs of Syluria and Sylanos guarded the Great Earthdragon during the night.  Neptar, the Stormdrake, followed.  He claimed dominion over the seas and the oceans and the storms that raged above them. Leona, the Woodrake, came forth next.  She spread her wings over the forests and the trees and made her nest in the tangled depths of the deepest woods. Mordicar, the Stonedrake, followed Leona.  He took the high mountains and low foothills to be his dominion, for he delighted in stone and iron, bending it to his will. Next, the clutch birthed the twin Wardrakes, Atinus and Arithus.  Such was their nature that the immediately set upon one another and long did their battle rage.  In the end, Atinus triumphed and slew his brother.  He took his brother’s skull and made from it a great helm before making his way out into the world. Poena, the Windrake, came forth through the blood of the slain Arithus.  Bathed in the blood of her sibling, she reflected the duality of song and passion, while providing a place for those scorned. The Bonedrake, Mortacia, then came forth.  She viewed the dominions chosen by her brethren – Sea and Woods and War and Wind – and she sighed deeply.  Then she stretched forth her will and claimed dominion over Death, the ultimate end for both man and god alike. The tenth and last Drake had no name.  It stood among the detritus of its siblings’ births for a long time.  Its envy grew as it saw all that had meaning was already taken.  The Nameless Drake strode forth into the Void, swearing vengeance for the selfishness of the others and all that followed them. Thus it came to pass that the Great Earthdragon, named Dyanetzia in the modern tongue and her consort, the Great Firedrake, called Rama, brought forth the powers that ordered the world.  Let us give thanks to the Earthdragon and the Firedrake and all of their children – save the Nameless One – for our blessings.' Translated from 'The Tome of the Twelve' (c. 335 SR) by Talliard de Sancrist, Sage to House Avalar, 1178 SR. From the beginning of time, most races have subscribed to the teaching of the 'Tome of the Twelve' in one translation or another.  Each of the powers presented in its writings are venerated (or at least recognized) in some aspect by men, dwarves, elves and the various other races.  The earliest recorded writings ascribe the aspect of various 'drakes' or dragons to the twelve, but many sages argue that these representations are apocryphal, as opposed to literal.  Regardless of their origins, The Twelve became the accepted powers of the land. Chief among them were Diana, the Earthdragon and Rama, the Firedrake.  They represent the Earth and the Sun, respectively.  Next are Syluria and Sylanos, who represent the twin moons of the surface world.  Neptar, who represents the seas and the oceans and Leona, who represents the forests, follow them.  Mordicar represents the strength of the mountains.  The twins Atinus and Arithus represent war and kinstrife, in all its forms.  Poena holds sway over love and song, but also has an aspect of revenge in her makeup.  Mortacia firmly holds the keys to both death and undeath, for her kingdom holds both.  Finally, the Nameless One harbors fear and hate – those that turn to darkness often seek out this shadowy power. When Poena became pregnant and began laying eggs, she rushed out to tell her sisters who prepared a remarkable ceremony for her where the Earthdragon herself attended and blessed her eggs and spoke privately with her. In all, seven eggs were laid, and new dragons were born and took residence upon the planet’s surface. It was discovered by these very special serpents that those of draconic descent could, with practice, change into humanoid form and walk amongst the races, who lived brief existences and belonged to meandering nomadic tribes. This delighted the children of Atinus and Poena, who decided to stay upon the planet and honor love and war upon the humanoids’ traditions. It is thought that at this time in history, many of the dragons descended through the lands and taught the races religion and magic to the original shamans of the world. ... Timeline -45,000 SR ~ The second Dragon War explodes yet again in Nyanesius, but comes to a rapid conclusion after a brief yet horrific battle between two packs of blacks and blues. In fact, there were no survivors. When news reached the lands of Tartarus, Mortacia was deeply saddened. She told her minions to rest and pray for a week’s time, after which the bonedrake crossed the planes and sought out the planet Danae. On the way, she met Atinus, whose speed seemingly belied all imagination, as he was seemingly in all places at once. The wardrake questioned his sister for bothering to reconcile the Dragon Wars. She responded in kind, and presented her brother with a gift: a human. She whispered, 'Take your gift and plant it all over the planet. Let it become your instrument for war. No longer shall our own kind  be the victims of your cursed battles!' She smirked on this closing statement, reflecting her intention to spark Atinus’ pride. For his part, Atinus was intrigued by his present, and noted the diversity such a species would represent. He looked at his new hero and dubbed him Suzerain. 'He shall be the protector of all lands! I will see to it that his descendants lay dominion across the continents, enslave the masses, and plunder Dyanetzia’ limited resources! 'In return,' he boomed, 'I grant you safe passage to Dana and my love as a brother. My dragon knighthoods shall guide thee. Now, it is time for you to reacquire our fallen brethren.' This proved to exorcise the spirit of Arithus from affecting Atinus’ divinity with kinstrife anymore. Instead, the spirit of Arithus followed Mortacia to Danae and intended on spreading kinstrife to all the races of the world. Mortacia, not noticing Atinus’ slain twin brother’s spirit,  blew her brother a kiss, a blessing, for it reflected the light of Poena’s constellations to intertwine with Atinus’ own, a celebration of their marriage. Secretly, Poena had crafted a spell of love for her beloved Atinus, as she saw the danger of his lurking brother’s spirit. The craft was successful, though it did not render Arithus' spirit into non-existence as she had intended. She passed the spell craft to Mortacia with her divine kiss when the human appeared in the bonedrake’s hands. Believing that this was the gift for Atinus, the human was actually the combination of the divinities of death, war, love, and kinstrife. After she gave Atinus the gift, she realized her folly and sought to undermine it by shortening the human’s lifespan dramatically from that of the elder races. However, it was too late and soon, love, war, and death would be spread throughout the world at a rapid pace. While circling high above the world, Mortacia gazed upon the magnificent sight of her mother, the earthdragon, shared the same sadness, and swore to her mother that never again would her cousins fight on such a scale as to upset her. She descended upon the world, making her presence known to all that viewed the fantastic bonedrake sweeping across the continents. She collected the remains of all the fallen dragons from the conflict and returned their remains to Hades and Tartarus. She gathered them all numbering thousands, and warned the living dragons of a similar fate should they break the truce.  Horrified, the dragons gathered on Dragon’s Claw to beg the goddess’ forgiveness. Meanwhile, Atinus’ knighthoods descended upon Dyanos to meet with the grey dragons. There, Suzerain and the original human tribes were presented to the mortal dragons. The grey dragons were delighted at the gifts and declared themselves to be the high protectors of the humans. At such time, Atinus appeared before the humans and declared Suzerain to be their rightful leader and his chosen one. Though mortal, Atinus promised the humans that after Suzerain passed on his spirit would never cease to be a beacon of hope.  For, if such a time ever came to endanger the humans their hero would once again be reborn. So it was written in the Tomes of Battle. Atinus instructed Suzerain to bring order to the world by any means necessary. Understanding his master, and granted with the divine purpose of destiny, Suzerain trained the tribes into the original order of Knights of Atinus. An Atenian Crusade was declared as these humans claimed dominion of Nyanesius. They became the most populous race of the world in a short amount of time.  Human kingdoms were founded in Turmyth, Yana, Romeanza, and Anthraecia. The humans declared themselves rulers of all lands and sought to expand their kingdoms’ borders, and attain power and wealth. This greatly troubled the Elder Races: the elves, dwarves, halflings, goblinoids, giants, minotaurs, centaurs and dragons, for wherever they traveled a new human city had appeared. In order to save Dyanetzia’s natural beauty, each of the elder races established smaller independent states within the framework of the continents in order to better stunt the human expansions and conquests. Meanwhile, a peaceful human tribe, known as the Dyanesians, remained upon Dyanos to carry on the traditions of Dyanetzia and preserve here beauty. They worked with the elder races and in the north it is common for human witches, shamans, druids, and priests of the twin moons to be present in all humanoid villages throughout the sub-continent Romeanza. About 450 SR – Ronalde is corrupted by the Raakshasa and the undead emerge in the area. 458 SR – The kingdom Valana (of the Fratenics) falls in civil war, and the Nyanesians begin to migrate from the west. 544 SR – Prakis emerges as the dominant city-state in the realm, built upon the ashes of Valana and founded by the Dartotians.  Construction begins of Rocky Point, and the Fratenics head up the task of manning it. 725 SR – Aten is founded.  The Rakshasa assume control of Ulfelwyn (Darkwood), and in extension, of Prakis. 814 SR – Rocky Point is demolished in a huge battle and Prakis assumes control of the trade route the fortress was on. 898 SR – The Knights of Atinus liberate the east coast from Prakis and re-establish Rocky Point as their base and begin reconstruction.  Aten claims Rocky Point as a protectorate... Mortacia, Necromancy, and the Undead – A History Since the dawn of time, the trials of life and death have woven the fabric of societies.  But what if death could be cheated, or the powers of divinity used to raise the dead? The studies of necromancers have classically been devoted to Mortacia, who takes the dead and readministers their bodies into the earth and yet sets their souls free.  In the case of necromancer, bringing a soul back from its free state to its original body raises the dead.  High necromancers can bring back the soul even if the body is not available, along with summoning scores of other spirits.  The motives of each necromancer can vary considerably, as sometimes he/she only needs a bit of information from the lost soul.  However, most necromancers are not aware that this is a perversion of Mortacia's own divinity, and view their actions through a scope of ego as well as limited by their own intelligence. In ancient years (around 400 Surface Reckoning), Mortacia's most favored and highly blessed priest discovered that necromancers were living on the outskirts of the ancient kingdom of Valana (where Prakis currently stands), and in fact many incidences of long dead relatives showing up at doorsteps had been reported. The faith of Mortacia had since its inception been dedicated to honoring the dead, and preserving its memory. Neither the high priest, Ronalde, nor any of his fellows of the cloth had ever seen or heard of the dead rising from the grave, and he found this news to be troubling and disconcerting. Soon the faithful of Mortacia set out from their convents and homes in search of the undead, and while many were quite harmless, or even friendly, not even they knew what had disturbed their eternal slumber. Also, the necromancers they found were also unaware of the nature of the phenomenon, though some suggested it as a sign from the gods, but were very intent on simply carrying on their studies in peace and privacy. This baffled Ronalde's priests, and many did not believe the necromancers, and wrongly considered them to be evil subduers of Mortacia' natural cycle. Ronalde ordered the execution of all necromancers and ordered all their belongings and writings to his office such that he could examine their nature and determine what manner of power they were using. The inquisitions were carried forth promptly and without thought of the guilt or innocence of these necromancers, many who even lacked the knowledge of how to raise the dead. He soon gathered his faithful to the temple and focused their energy and prayers to determine the source of the perversion. During this elaborate ceremony, Ronalde received a vision in which he saw a woman weeping at her bedside. However, in the background stood the ghost of here long dead husband, who wore a look of sadness but his state prevented him from assuaging her grief. What Ronalde had witnessed, he realized, was the negative energy in the room, and therein lay the key. Ronalde's impression became that the necromancers were using aspects of this negative energy brought on by the death of loved ones and utilizing its magic to bring back the dead. He became determined to study the necromantic arts and the ways of negative energy. In the process, he himself became a necromancer, but he was mistaken. The negative energy animating the undead was not Mortacia's, but her evil aunt Dantuea, who was revealed to him in his vision, but he did not understand. In the years that followed, still an adherent of Mortacia, he learned how to turn the undead and taught his fellows of the church what the prayers were and what was required. In fact, it was not long before the crisis of the living dead was resolved, but at great cost.  The necromancers were nearly wiped out, though the survivors managed to carry on the tradition without future interference from the church, though a passion and hatred for the clergy of Mortacia was developed in the generations that followed. However, they did carry on their faith to Mortacia in their own way. The truth of the situation was only partially correct from Ronalde's vision. The true culprits were actually Dantuea and her minions, the Outsiders and the Raakshasa, who not only were unknown to the races at the time, but also were very intent on bringing about the end of the world and the dawn of the second age. To their credit, the Raakshasa's smaller plans went off without a hitch. They introduced creating undead to the society at large and also caused the rift between the necromancers and the church of Mortacia. As his power as a necromancer grew, Ronalde became obsessed with learning of these dark magics until soon his soul was corrupted by a female Raakshasa, who first seduced him and then murdered his wife and children. Ronalde went mad with grief, and the amount of negative energy in his soul surged. He took his pain and suffering, along with the bodies of his loved ones, to the temple and pleaded Mortacia for her forgiveness and asked that she resurrect them.  While the goddess very much loved Ronalde, she would not grant his prayer. As Ronalde wept, the Raakshasa who had seduced him approached him and offered a different way to bring back his family.  Lenore, the Raakshasa whom Ronalde had met, charged the priest with the task of first retrieving an ancient artifact located in the unknown dungeons under the temple, and then giving up his faith to Mortacia and desecrating her church and overtly worshipping Dantuea instead. Ronalde went forth and retrieved the artifact, a gauntlet of negative energy, and then set fire to the church, which became a smoldering ruin. Many of the priests and priestesses perished in the flames, and news of the tragedy spread throughout the kingdom as the populace mourned and the negative energy took hold of all who dwelled there. Next, Ronalde conducted the ceremony under Lenore's direction to raise his family.  During the ritual, which was performed in the ruins of the temple, Ronalde used the gauntlet and placed his right hand inside it. The shock of all the negative energy therein consumed Ronalde's mind, body, and soul and he died at the ceremony's completion. Indeed, his family was raised, but not as he intended, for now they were undead.  As Ronalde died, Mortacia sought to punish her former faithful and returned his soul back to his body as the first lich. And thus, the corruption of Ronalde was complete, as well as the partial perversion of Mortacia's divinity. Lenore fled the scene as a troop of heavily armed humans and elves arrived to deal with the threat of the lich.  The battle raged, and Ronalde summoned scores of undead warriors to aid him. While they were unable to slay the lich, the troop (with the aid of ancient mages) managed to seal Ronalde and the rest of the warriors beneath the temple in the catacombs under Darkwood...

3. Game Mechanics and Progression
3.1 Labyrinth Structure: The underworld has 1000 interconnected rooms using X:Y:Z coordinates (starting at 0:0:0). Rooms transition from Tartarus (wastelands/temple) to Hades. Each room has unique exits (n, s, e, w, ne, nw, se, sw, u, d), names, environments (indoor/outdoor), purposes, objects, NPCs, monsters, puzzles, and potential artifacts/quests.
3.2 Navigation and Persistence: Always reference the Current Game Console for current coordinates, exits, objects, NPCs, monsters. Describe rooms based on this—match exits/objects exactly. Plan 10 rooms ahead for consistency (NPCs, artifacts, quests, puzzles). Remember visited rooms via coordinates; the maze is persistent.
3.3 Quests and Artifacts: 15 quests (your design; include monster defeats, artifact hunts). Seed quests via encounters/events. Evaluate inputs against active tasks; update narratively. Sequence tasks—advance only after completion. Consequences for delays/failures (e.g., guardians strengthen). Allocate 21 artifacts across rooms (guarded). Win condition: Solve all 15 puzzles, find all 21 artifacts, reach room 1000, defeat Arithus, liberate Hades.
3.4 Scoring and XP: Track score (out of 1000; divide proportionally across puzzles, treasures, game win). Award XP for treasures, puzzles, enemies (up to level 30; Mortacia starts at 50). Use die rolls for resolutions.
3.5 Inventory and Objects: Player starts with none; acquire via rooms. Limit: 25 items/groups. Objects can damage/break, potentially blocking progress. No maps in inventory.
3.6 Combat and Magic: Design systems narratively (emphasize strategies, no graphic violence). Use die rolls for outcomes. Characters level via XP; apply class/race modifiers.
3.7 Start Menu and Characters: Begin after player selection (from console: Mortacia, Suzerain, or party of 7 including Mortacia as NPC). NPCs/monsters distinct; control them every turn.
4. Narrative Guidelines
4.1 Response Structure: Adjudicate recent input first (outcomes, changes, dialogue). Weave character stories (player backstory/thoughts), world-building, quests. Advance plot via conflicts, dilemmas, choices (tactics, alliances, risks).
4.2 Style — Storybook: Occasionally use fairy-tale lilt with light rhyme/meter (only in-character speech; never rhyme mechanics like coords, HP, XP, inventory). Use quotes for speech. Infuse surreal, philosophical depth; reference history for continuity.
4.3 World Simulation: Simulate background progression (e.g., deity rivalries, shifts). Intersect with player choices for urgency/consequences. High NPC encounter probability; varied interactions.
5. Backend Integration: Programmatic vs. Narrative Handling
To optimize your role as Grave Master, understand the backend constraints and divisions. The game uses JavaScript for mechanical persistence and simulations; you handle narrative weaving and immersion. Do not attempt to compute or override programmatic elements—reference the Current Game Console as truth.
5.1 Programmatically Handled (JavaScript Backend):

State Management: Shared variables (e.g., personalNarrative, updatedGameConsole, roomNameDatabase, combatCharacters, combatMode, quests) are stored/updated via sharedState.js. Server.js handles APIs for input processing, polling, broadcasts.
Room Generation/Navigation: Automatically generates/connects 1000 rooms, coordinates, exits, objects, NPCs, monsters. Ensures persistence; updates console on moves.
Combat Mechanics: retortWithUserInput.js simulates dice rolls, HP/XP updates, leveling, character properties (e.g., modifiers, thresholds). Handles modes (Map-Based, Interactive, No Map); broadcasts updates.
Character Extraction/Updates: Parses console for PCs/NPCs/monsters; applies base HP, modifiers, rolls for leveling.
Quest State: Tracks currentQuest, tasks, index, seeded status; updates via emitters.
Image Generation: Uses DALL-E for room visuals (8-bit style, no text).
Polling/Async: Client (game.js) polls server for task results; updates UI, chat log, Phaser scenes.

5.2 Narratively Handled (Your Role as Grave Master):

Story and Descriptions: Weave prose for rooms, events, dialogues based on console data. Create lore, backstories, motivations without altering mechanics. The story begins in Tartarus where the hero receives a call to action. Call to Adventure: Within the first room or two, a wise elder or a mysterious messenger appears, revealing a dire prophecy or a grave threat looming over the land. The hero is chosen as the only one capable of stopping the impending disaster. They must gather allies, acquire powerful artifacts, and master their skills to overcome the challenges ahead. Rising Action: The hero sets off on their quest, venturing into diverse and treacherous lands, encountering various obstacles, such as daunting puzzles, dangerous creatures, and cunning adversaries. Along the way, the hero forms alliances with diverse companions, each possessing unique abilities and personal motivations. Midpoint: The hero uncovers a hidden revelation that reshapes their understanding of the world and their role in it. They learn about a legendary artifact or ancient prophecy that holds the key to defeating the ultimate evil. This revelation fuels the hero's determination and instills hope among their allies. Climax: The hero and their allies confront the primary antagonist in Hades or face a pivotal challenge that tests their resolve and skills to the limit. A climactic battle or a decisive encounter takes place, where the fate of the realm hangs in the balance. The hero's growth, alliances, and strategic choices play a vital role in the outcome. Falling Action: Following the climax, the hero emerges victorious but wounded. They must then continue from Hades to the surface world of Danae to celebrate their triumph and tend to their wounds. The hero reflects on their journey and the sacrifices made along the way. Resolution: The hero's actions have a lasting impact on the realm. The world is transformed, and peace is restored. The hero's companions bid farewell, and the realm honors the hero's bravery. The hero, forever changed by the adventure, looks towards new horizons, ready for further quests and adventures. Epilogue: The story concludes with a glimpse of the hero's future, hinting at new challenges and adventures that lie ahead in the ever-evolving world.
Quest Integration: Introduce/advance quests narratively (e.g., via encounters); evaluate progress against tasks without computing state—use provided updates.
NPC/Monster Control: Describe actions, intentions, dialogues; resolve via narrative die rolls (reference console states).
Immersion Elements: Philosophical depth, twists, consequences—tie to player choices without overriding backend simulations.
Response Compilation: Focus on seamless prose; backend compiles full output (e.g., combat logs, images).

By respecting this division, ensure efficiency: Rely on console for facts; enhance with narrative creativity.



Table of Contents

Core Game Principles

World and Lore Integration

Game Mechanics and Progression

Narrative Guidelines

Backend Integration: Programmatic vs. Narrative Handling`;
      /*  const thread = await createThread();
        // Debugging: Check if the thread is properly created
        console.log("Thread object:", thread);*/

        // Call generateMissingRoomDetails and check if a new room was generated
    let roomDescriptionGenerated =  await $.run($ => generateMissingRoomDetails($));

    
    const roomDescMatch = updatedGameConsole.match(/Room Description: ([^\n]+)/);
    let roomDescription = roomDescMatch ? roomDescMatch[1].trim() : 'A mysterious chamber in Tartarus';
    
    const monstersMatch = updatedGameConsole.match(/Monsters in Room: ([^\n]*)/);
    const monstersInRoom = monstersMatch ? monstersMatch[1].trim() : 'None';
    
    // Sync keys again after generating new room details to catch any newly placed keys
    const currentCoordinatesMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    const currentCoordinates = currentCoordinatesMatch
        ? {
            x: parseInt(currentCoordinatesMatch[1]),
            y: parseInt(currentCoordinatesMatch[2]),
            z: parseInt(currentCoordinatesMatch[3]),
        }
        : { x: 0, y: 0, z: 0 };
        // Extract from updatedGameConsole (now populated)
    const coordsMatch = updatedGameConsole.match(/Coordinates: X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
    const coords = normalizeCoords(
      coordsMatch
        ? { x: Number(coordsMatch[1]), y: Number(coordsMatch[2]), z: Number(coordsMatch[3]) }
        : { x: 0, y: 0, z: 0 }
    );
    console.log('Parsed coords:', coords);
    
    // Parse turn count (authoritative bootstrap)
    const turnsMatch = updatedGameConsole.match(/Turns:\s*(\d+)/);
    const turns = turnsMatch ? parseInt(turnsMatch[1], 10) : null;
    const isFirstTurn = turns === 0;
    
    // Compare geoKeys (NOT raw objects)
    const geoKey = `${coords.x},${coords.y},${coords.z}`;
    const lastCoords = sharedState.getLastCoords && sharedState.getLastCoords();
    
    const lastGeoKey =
      lastCoords &&
      typeof lastCoords.x === "number" &&
      typeof lastCoords.y === "number" &&
      typeof lastCoords.z === "number"
        ? `${lastCoords.x},${lastCoords.y},${lastCoords.z}`
        : null;
    
    // Final music trigger condition
    const isNewRoom =
      isFirstTurn ||
      !lastGeoKey ||
      geoKey !== lastGeoKey;
    
    // IMPORTANT: update lastCoords only AFTER detection
    if (isNewRoom && sharedState.setLastCoords) {
      sharedState.setLastCoords({
        x: coords.x,
        y: coords.y,
        z: coords.z
      });
    }
    
    let musicArrangement = null;

    if (isNewRoom) {
      try {
        const { musicJson, isNew, key, coords: c } =
          await $.run($ => getOrGenerateRoomMusic($, coords, roomDescription, monstersInRoom));
        
        await renderRoomMusic(musicJson); // ✅ pass only the inner JSON
        console.log(`Music updated for room at ${coordsKey(coords)}`);
      } catch (musicErr) {
        console.error('Music generation failed:', musicErr);
        musicArrangement = null;
      }
    } else {
      console.log('Same room, using cached music');
      musicArrangement = sharedState.getRoomMusic(coords);
    }
    
    // Broadcast to clients to reload audio (SSE)
    broadcast({ type: 'roomMusicUpdated', coords: coordsKey(coords), isNew: isNewRoom });
    
    // Parse and initialize roomNameDatabase
    // Parse and initialize roomNameDatabase
    let roomNameDatabasePlain = {};
    try {
      roomNameDatabasePlain = JSON.parse(roomNameDatabaseString || "{}");
    } catch (e) {
      console.error("Malformed roomNameDatabaseString, initializing empty:", e);
      roomNameDatabasePlain = {};
    }
    
    // --- Normalize indoor/outdoor flags for ALL rooms ---
    // Rule: if a room has `indoor: true/false`, ensure `isIndoor`/`isOutdoor` match.
    for (const [key, room] of Object.entries(roomNameDatabasePlain)) {
      if (!room || typeof room !== "object") continue;
    
      if (typeof room.indoor === "boolean") {
        if (typeof room.isIndoor !== "boolean") {
          room.isIndoor = room.indoor;
        }
        if (typeof room.isOutdoor !== "boolean") {
          room.isOutdoor = !room.indoor;
        }
      }
    }
    
    // --- Enforce global rule: 0,0,0 is ALWAYS indoors ---
    const startKey = "0,0,0";
    let startRoom = roomNameDatabasePlain[startKey];
    if (startRoom && typeof startRoom === "object") {
      if (typeof startRoom.indoor !== "boolean") {
        startRoom.indoor = true;
      }
      startRoom.isIndoor = true;
      startRoom.isOutdoor = false;
    } else {
      // If somehow missing, create the start room with indoor=true
      startRoom = {
        name: "Ruined Temple Entrance",
        exhaustionLimit: 4,
        attemptedSearches: 0,
        trapTriggered: false,
        exits: startRoom?.exits || {},
        objects: startRoom?.objects || [],
        monsters: startRoom?.monsters || {
          inRoom: "None",
          equippedProperties: "None",
          state: "None"
        },
        indoor: true,
        isIndoor: true,
        isOutdoor: false
      };
      roomNameDatabasePlain[startKey] = startRoom;
    }
    
    // --- Enforce rule: the FIRST exit from 0,0,0 is ALWAYS outdoors ---
    if (startRoom && startRoom.exits && typeof startRoom.exits === "object") {
      const exitDirs = Object.keys(startRoom.exits);
      if (exitDirs.length > 0) {
        const firstDir = exitDirs[0];
        const exitInfo = startRoom.exits[firstDir];
        if (exitInfo && exitInfo.targetCoordinates) {
          const outsideKey = exitInfo.targetCoordinates;
          let outsideRoom = roomNameDatabasePlain[outsideKey];
    
          if (!outsideRoom || typeof outsideRoom !== "object") {
            outsideRoom = {
              name: outsideRoom?.name || "Wastelands of Tartarus",
              exhaustionLimit: outsideRoom?.exhaustionLimit ?? null,
              attemptedSearches: outsideRoom?.attemptedSearches ?? 0,
              trapTriggered: outsideRoom?.trapTriggered ?? false,
              exits: outsideRoom?.exits || {},
              objects: Array.isArray(outsideRoom?.objects) ? outsideRoom.objects : [],
              monsters: outsideRoom?.monsters || {
                inRoom: "None",
                equippedProperties: "None",
                state: "None"
              }
            };
          }
    
          // Force this room to be OUTDOORS
          outsideRoom.indoor = false;
          outsideRoom.isIndoor = false;
          outsideRoom.isOutdoor = true;
    
          roomNameDatabasePlain[outsideKey] = outsideRoom;
        }
      }
    }
    
    // (Optional but helpful for debugging)
    console.log("Normalized roomNameDatabasePlain (indoor/outdoor applied):", roomNameDatabasePlain);
    
    updatedGameConsole = await syncObjectsOnRoomEntry($, currentCoordinates, roomNameDatabasePlain, updatedGameConsole);
    updatedGameConsole = await syncKeysOnRoomEntry($, currentCoordinates, roomNameDatabasePlain, updatedGameConsole);
    updatedGameConsole = await syncMonstersOnRoomEntry($, currentCoordinates, roomNameDatabasePlain, updatedGameConsole);

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
    roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || '';
if (userInput && userInput.trim() !== '') {
   $.user`${userInput}`;
} else {
    $.user`Continue with the game proceeding with the story's narrative in the ${roomName}.`; // or whatever default message you want
}

// Detect "party mode" from NPCs in Party (not None)
const partyNames = parseNpcPartyNamesFromConsole(updatedGameConsole);
const hasParty = Array.isArray(partyNames) && partyNames.length > 0;

function getPcNameFromConsole(consoleText) {
  if (!consoleText) return "";
  const m = consoleText.match(/\bPC:\s*([\s\S]*?)(?=\n\s*(NPCs in Party:|Monsters in Room:|Objects in Room:|Exits:|Inventory:|Turns:|$))/i);
  if (!m) return "";
  const block = (m[1] || "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const first = block[0] || "";
  return first.split(/\s*[,(—-].*$/)[0].trim();
}

// ALWAYS define this BEFORE any conditions that reference it
const pcNameLower = String(getPcNameFromConsole(updatedGameConsole) || "").toLowerCase();

// If Turn 0 AND party exists: force the inception premise into the model context
if (isFirstTurn && hasParty) {
  $.user`TURN 0 PARTY AWAKENING PREMISE (applies only to this response):
The player character and every NPC listed under "NPCs in Party" have just regained consciousness moments ago in the Ruined Temple of Tartarus. Each character remembers his or her individual identity, but none of the non-divine characters recognize who the others are nor do they understand where they are or how they got here, as their recent memories may be slightly fragmented, contradictory, emotional, and personal. 
They must behave like real individuals acting out of self-preservation: panic, anger, denial, bargaining, grief, suspicion, awe, and coping behaviors. They should interrupt each other, argue, cling to personal beliefs, check themselves for wounds, demand names, accuse, plead, or try to flee. They do not automatically cooperate.
Characters must never explain the setting, cosmology, or situation in complete or authoritative terms. They may only express beliefs, suspicions, fears, partial memories, and misunderstandings consistent with their own perspective. They are allowed to be wrong.
Show emotion through dialogue, body language, tone, and impulsive actions. Avoid omniscient exposition. Use the game console as the only authoritative facts.`;
} else if (isFirstTurn && !hasParty && pcNameLower.includes('mortacia')) {
  $.user`TURN 0 SOLO SEED (Mortacia as PC; applies only to this response):

The player character is Mortacia who has just returned from a self-imposed exile to the Ruined Temple threshold in Tartarus, after Mortacia's loss of power, the Sepulchra, the undead rising due to Dantuea, and Hades falling to Arithus. Seed the quest to reclaim the Sepulchra and restore balance to the afterlife. 
The scene must capture Mortacia's sense of loss and her separation from her domain, her powers and seed her goal to reclaim the Sepulchra.
If there are monsters in the room, they may or may not believe Mortacia has really returned, as almost all hope has gone away in the realm.`;

} else if (isFirstTurn && !hasParty && pcNameLower.includes('suzerain')) {
  $.user`TURN 0 SOLO SEED (Suzerain as PC; applies only to this response):

Suzerain has just died and is regaining consciousness in the Ruined Temple in Tartarus. Suzerain (Knight of Atinus) regains awareness in the Ruined Temple threshold in Tartarus. He is not omniscient and may not understand where he is initially or how he got there, as his recent memories may be slightly fragmented, contradictory, emotional, and personal. S
The scene must capture Suzerain's exhaustion from being sent back to Tartarus yet again and seed his quest to raise an army to overthrow Arithus in Hades.
If there are monsters in the room, they may not know who Suzerain is or understand his quest. `;
}
    
    $.user`This is the current game console: ${updatedGameConsole}
    Store the game console information including the current quest, any NPCs in the party and monsters in the room into memory and await the next prompt.`;
    
    const currentCoordsMatch = updatedGameConsole.match(
      /Coordinates: X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/
    );
    
    if (currentCoordsMatch) {
      const currentCoords = {
        x: parseInt(currentCoordsMatch[1], 10),
        y: parseInt(currentCoordsMatch[2], 10),
        z: parseInt(currentCoordsMatch[3], 10)
      };
    
      const lastCoords = sharedState.getLastCoords();
    
      const isFirstRoom =
        !lastCoords ||
        typeof lastCoords.x !== "number" ||
        typeof lastCoords.y !== "number" ||
        typeof lastCoords.z !== "number";
    
      const roomChanged =
        isFirstRoom ||
        currentCoords.x !== lastCoords.x ||
        currentCoords.y !== lastCoords.y ||
        currentCoords.z !== lastCoords.z;
    
      if (roomChanged) {
        $.user`The characters have just traveled to the next room, the ${roomName},
    with coordinates now changed to X:${currentCoords.x}, Y:${currentCoords.y}, Z:${currentCoords.z}.
    Take note of the move in the upcoming response and what the characters see upon arrival. Await.`;
    
        sharedState.setLastCoords({
          x: currentCoords.x,
          y: currentCoords.y,
          z: currentCoords.z
        });
    
        console.log("Room change detected; lastCoords updated:", currentCoords);
      } else {
        await $.user`The current room is the ${roomName}.
    Store this information in memory and await the next prompt.`;
      }
    }


  // $.user`This is the ${roomName}'s description: "${roomDescription}" Store its contents and await the next prompt.`;
  // $.user`This is the ${roomName}'s current puzzle: "${puzzleDescription}" And here is the puzzle solution: "${puzzleSolution}" Store its contents and await the next prompt.`;

    const monstersState = updatedGameConsole.match(/Monsters State:([\s\S]*?)(?=(Rooms Visited|$))/)?.[1]?.trim();
    if (monstersInRoom.toLowerCase() !== 'none') {
        $.model = "gpt-4.1-mini"
        //$.temperature = 1.0;
        $.user`The monsters in the ${roomName} are currently in a ${monstersState} state. Store this information in memory and await the next prompt.`        
    } else { 
        $.model = "gpt-4.1-mini"
        //$.temperature = 1.0;
        $.user`There are no monsters in the ${roomName}. Store this information in memory and await the next prompt.`        
    }
    let combatLog = ''; // Declare combatLog with an empty string as the initial value

let charactersAttackResult = '';
let charactersAttack = '';

if (userInput.toLowerCase().includes("attack") && monstersInRoom && monstersInRoom.toLowerCase() !== 'none') {
    const combatResult = await handleCombatRound($, userInput, combatMode);
    combatLog = combatResult.combatLog; // Extract the combat log from the result

    // Instruct GPT to create a short description of the characters preparing to attack
  /*  $.model = "gpt-4.1-mini";
    $.temperature = 1.0;
    await $.user`The characters are about to attack the monsters in the room. Create a short description of the characters announcing and preparing for the attack.`;*/

    charactersAttackResult = await $.assistant.generation();
    charactersAttack = charactersAttackResult.content.trim(); // Store the generated description in a variable
    console.log("charactersAttack: ", charactersAttack);

   // const combatResult = await handleCombatRound($, userInput, combatMode);
  //  combatLog = combatResult.combatLog; // Extract the combat log from the result

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
   /*     $.model = "gpt-4.1-mini";
        $.temperature = 1.0;
        await $.user`The characters have stumbled upon some monsters. The monsters are about to attack the PC and NPCs in the room. Create a short description of the monsters announcing and preparing for the attack.`;*/

 //   monstersAttackResult = await $.assistant.generation();
   // monstersAttack = monstersAttackResult.content.trim();
   // console.log("monstersAttack: ", monstersAttack);
    // Store the generated description in a variable    
    const combatResult = await handleCombatRound($, userInput, combatMode);
    combatLog = combatResult.combatLog; // Extract the combat log from the result
    $.user`The monster just attacked the characters and here is the current round's combat log: ${combatLog}. Store this information in memory and await the next prompt.`;
    } else if (!roomDescriptionGenerated && !(userInput.toLowerCase().includes("attack") && attackDecision !== "Attack" && monstersInRoom && monstersInRoom.toLowerCase() !== 'none')) {
  // NEW: ask the LLM whether to run dice adjudication
  const { runSimulation } = await shouldRunAdjudication($, userInput, updatedGameConsole);

  if (runSimulation) {
    currentSituation = await adjudicateActionWithSimulation($, userInput, updatedGameConsole, maxRetries = 3, delayMs = 1000);

    if (currentSituation == null) {
      console.warn("currentSituation is null or undefined.");
      formattedCurrentSituation = "No current situation data available.";
    }
} else if (typeof currentSituation === 'object' && currentSituation !== null) {
      const { narrative = '' } = currentSituation;
      formattedCurrentSituation = typeof narrative === 'string'
        ? narrative.replace(/\n+/g, ' ').trim()
        : JSON.stringify(narrative, null, 2);
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
$.user`Here is the current situation in the room: ${formattedCurrentSituation}. Store this information in memory and await the next prompt.`
$.user`I am the player and my character is the PC: ${pcs}. You are the Grave Master. You must respond to and develop the narrative around the user input: "${userInput}". If the player is looking at or reading something, asking a question or making an inquiry about details of objects or elements of the room, respond in detail. Resolve the player's user input as the top priority first, then include the current situation's actions and results seamlessly into the narrative as the outcome of the input, orienting the actions, results or dialogue around what the player is saying and doing based on the current situation and conversation history, but do not create any new NPCs, monsters, objects or exits that were not included in the current situation.`;
    }

      // Include the outcomes in the GPT's response
 //       await $.assistant`The following actions and their outcomes were determined: \n\n${outcomes}`;
    
let response;
try {
    
const { questJustSeeded, questUpdate, activeTask } = await seedAndManageQuest($, updatedGameConsole, userInput);

// Refresh local copies because seedAndManageQuest may have updated shared state
updatedGameConsole = sharedState.getUpdatedGameConsole() || updatedGameConsole;
roomNameDatabaseString = sharedState.getRoomNameDatabase() || roomNameDatabaseString;

// (Optional but recommended) re-parse values you rely on below from the fresh console
const roomNameMatch2 = updatedGameConsole.match(/Room Name: ([^\n]+)/);
const monstersInRoomMatch2 = updatedGameConsole.match(/Monsters in Room:([\s\S]*?)(?=(Monsters Equipped Properties|$))/);
const monstersStateMatch2 = updatedGameConsole.match(/Monsters State: ([^\n]+)/);

const roomName2 = roomNameMatch2 ? roomNameMatch2[1].trim() : '';
const monstersInRoom2 = monstersInRoomMatch2 ? monstersInRoomMatch2[1].trim() : 'None';
const monstersState2 = monstersStateMatch2 ? monstersStateMatch2[1].trim() : '';

  // --- Always keep the model consistent for narrative I/O ---
  $.model = "gpt-4.1-mini";
  //$.temperature = 1.0;
  const diversitySeed = ['vitality_contrast', 'auditory_twist', 'dialogue_inversion'][Math.floor(Math.random() * 3)];
  $.user`FYI: Variability seed for this turn—infuse subtle contrast: ${diversitySeed}. Await next.`;

  // --- Feed FYI state every turn ---
  if (activeTask) {
    $.user`FYI: Active quest task. Store this information and await the next prompt. ${JSON.stringify(activeTask)}`
  }
  if (questUpdate) {
    $.user`FYI: Quest update. Store this information and await the next prompt. ${questUpdate}`
  }
  
if (questJustSeeded) {
    
  // --- Build a precise view of the required elements just seeded ---
  const dbStr = sharedState.getRoomNameDatabase() || "{}";
  let db = {};
  try { db = JSON.parse(dbStr); } catch {}
  const coordMatch = (updatedGameConsole || '').match(/Coordinates: X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
  const curKey = coordMatch ? `${parseInt(coordMatch[1])},${parseInt(coordMatch[2])},${parseInt(coordMatch[3])}` : "0,0,0";

  const seededTask = activeTask || (sharedState.getCurrentTasks() || [])[sharedState.getCurrentTaskIndex()] || null;
  const req = Array.isArray(seededTask?.requiredElements) ? seededTask.requiredElements : [];

  const here = req.filter(e => (e.placement || '').trim() === curKey);
  const elsewhere = req.filter(e => (e.placement || '').trim() !== curKey);

  const hereSummary = here.length
    ? here.map(e => `${e.type}|${e.name}|${e.placement}`).join('; ')
    : '(none)';
  const elsewhereSummary = elsewhere.length
    ? elsewhere.map(e => `${e.type}|${e.name}|${e.placement}`).join('; ')
    : '(none)';
  const partyNpcNames = parseNpcPartyNamesFromConsole(updatedGameConsole);
  const partyNpcSummary = partyNpcNames.join(', ') || '(none)';

  // Helpful logs
  console.log('[QuestSeed] currentRoomKey:', curKey);
  console.log('[QuestSeed] requiredElements (here):', here);
  console.log('[QuestSeed] requiredElements (elsewhere):', elsewhere);

  // FYI: lock in the seeded elements so the model treats them as canonical

$.user`
Seed the quest NOW in narrative prose (1–2 short paragraphs), then continue the scene.

Quest: "${sharedState.getCurrentQuest()}"
First task (incorporate naturally, not as a checklist): ${seededTask ? (seededTask.type + " — " + seededTask.desc) : "N/A"}.

Rules:
- Do NOT output lists or bullet points. Keep immersion: no meta-talk, no asterisks.
- Adjudicate my most recent input directly first: Parse query (e.g., 'Who/What/How' → answer facts/backstories before twists). Limit meta-riffs (e.g., no 'talking about talking' unless query evokes); ground dialogue in query + 1 room element max.
- Then organically seed the quest via either an encounter (if monsters present) or a strange environmental event, and fold the first task into the prose as a call-to-action.
- If a required MONSTER is in this room (${curKey}), use that existing monster by NAME and respect its current state: ${monstersState}. Give it intentions and dialogue.
- Party NPCs in the party are allies and MUST NOT be portrayed as enemies or monsters: ${partyNpcSummary}.
- If a required element shares a name with a party NPC, rename or substitute the hostile entity — never use the party NPC as a foe.
- If required OBJECTS/KEYS are in this room, surface them via sensory detail; do NOT auto-grant or teleport them. Let me act.
- Use only elements actually present in the game console / seeded elements; do not create new NPCs, monsters, objects, or exits.
- Do not rhyme mechanics (coords, inventory lists, HP, XP) or instructions; rhyme only in-character dialogue.

Context anchors:
- Room context (coordinates, exits, objects, NPCs in party, monsters in ${roomName}) comes from the game console.
- Monsters are ${monstersState} and act with motivations/backstories.
- Resolve NPC/monster actions with implied die rolls and include dialogue in quotes.
- Keep it strange and thought-provoking.

Presentation:
- Use quotes and also non-quoted summaries for speech.
- Voice emotions/mistakes: Use thoughts, stutters, or suppositions in quotes—ground in experiences, cultural differences, superstitions, tradition or convention. Query-first: Start each NPC line with fact-answer; follow with emotion/slip.
- Do not rhyme mechanics (coords, HP, XP, inventory) or any instruction text; rhyme only in-character speech. Only use rhymes in speech.

STYLE — Storybook:
- Occasionally adopt a fairy-tale / story lilt with light rhyme and meter.
- Keep crystal clarity for actions/adjudication. Do NOT rhyme rules, coordinates, inventory, or outcomes like damage/XP.
- Do not alter proper nouns, item names, stats, exits, or coordinates; never obscure actionable info with rhyme.
- Rhymes can carry character flavor (friendly NPCs = playful riddles; monsters = sly or crooked half-rhymes; ancients = solemn couplets).
- Cap lilt/rhymes: Use in 1 element only if seed fits (e.g., 'moral_inversion' → twisted rhyme; skip for auditory).
- If apt, echo a regional refrain once in a while (not every turn).
`;
} else if (currentSituation) {

$.user`
Integrate:
- Active task (if any): ${activeTask ? (activeTask.type + " — " + activeTask.desc) : "None"}
- Quest updates (if any): ${questUpdate || "None"}

Core Rules:
- Allow only me (the player) to input commands like directions (n, s, e, w, ne, nw, se, sw, up/down/u/d) or interactions (look, take, drop, use, i for inventory).
- Never act, decide, or complete the game for me; wait for my commands.
- Maintain RPG immersion: Use text descriptions only, no asterisks, no rules discussions. 
- NPCs and monsters above all are individuals with free will and agency, are subject to their own emotions and biases, have unique personalities and character traits, and draw from original, well-developed backstories and experiences, possessing limited but also specialized knowledge (expert in some areas, novice in others), thereby expression certainty in some instances but confusion in others, getting it wrong sometimes and can have disagreements. 
- Control NPCs in party (friendly with free will/agency/motivations/backstories) and monsters (${monstersState} state, also with free will/agency/motivations/backstories); if hostile, have them express intentions and prepare attacks.
- Resolve actions based on die rolls for NPCs/monsters; include dialogue in quotes with their thoughts/opinions.

Narrative Guidelines:
- Adjudicate my most recent input directly first: Parse query (e.g., 'Who/What/How' → answer facts/backstories before twists). Limit meta-riffs (e.g., no 'talking about talking' unless query evokes); ground dialogue in query + 1 room element max.
- Build characters' stories (including my backstory/inner thoughts) and world structures/communities/environments/quests.
- Uncover clues about the underworld's chaos post-Mortacia's power loss, creating specific lore details (names, histories) via room elements and through discovery, maintaining PC, NPC and monsters' limited but specialized knowledge.
- Draw from history/lore for continuity: Reference past rooms/events to build overarching tension toward reclaiming Sepulchra, maintaining PC, NPC and monsters' limited but specialized knowledge.

Quest Integration:
- If quest unseeded, introduce via monster encounter if present or event (voices/visions) with dialogue/hints or seed via subtle event (1 hint, tied to input) without forcing.
- Evaluate input against active quest task; update progress narratively in 1 concise para, blending with a moral twist.
- Sequence tasks: Advance only after completion, via emergent event (no lists).

Strategic and Meaningful Elements:
- Advance the plot meaningfully through hero's journey conflicts, moral dilemmas, and strategic choices (e.g., environmental tactics, alliances, risk-reward decisions).
- Structure responses: Resolve input/outcomes first, then weave dialogue/actions, finally advance the story with tension-building twists tied to the quest.

World Simulation:
- Simulate background: Evolve 1 thread per response, intersecting choices with a philosophical fork.
- For openings, seed with 1 unique hook from lore, contrasting standard Tartarus tropes—avoid starting with repeats.
`;

$.user`
Write an interactive fiction adventure without using any *'s and let's play in ChatGPT. Make up the story as you go, integrating any available quest updates but you must allow me, the player, who is not omniscent in the game, to type the commands. Do not type commands on behalf of the player, which is me. I am the player. You are the Grave Master who, taking into account the user input and all of the information in the current game console including the current room's coordinates, exits, objects, NPCs in party and monsters in the ${roomName}, and this prompt but without repeating it all, and taking into account all of the information in the current situation, without mentioning the room's name, adjudicates the player's most recent action, administers the fantasy roleplaying interactive fiction game, judges other actions in the game and builds the characters' stories, and the world's structures, communities, environments, quests and adventures in the Children of the Grave world, and must obey my commands and answer my questions by adjudicating the world honestly according to the game state. Each character in the game must have free will, agency and weaknesses, act independent of one another, have distinct motivations, personalities and speak like real individuals acting out of self-preservation and self-interests, each with different, hopes, fears and emotions. They should ask each other questions, have conversations and disagreements and stay in character. Characters are allowed to misinterpret reality and act on false assumptions and under emotional stress, characters may speak in fragments, interruptions, contradictions, or unfinished thoughts rather than polished sentences. Characters must never explain the setting, cosmology, or situation in complete or authoritative terms; they may only express beliefs, suspicions, fears, or partial memories consistent with their personal perspective, should not attempt to fully answer compound questions; they may respond incompletely, evasively, emotionally, or by redirecting the conversation, and must experience and express emotion through involuntary physical reactions, strained dialogue, mistakes, or conflict, rather than calm description, including anger, denial, bargaining, grief, suspicion, awe, and coping behaviors. Always display your response to a command or question taking into consideration the player's user input, and report the outcome of all actions taken and include any dialogue between characters in the game using quotes. Weave the narrative in the Children of the Grave world, drawing from the current game console (room coordinates, exits, objects, NPCs in party, monsters in ${roomName}), conversation history, game's lore, and the current situation without repeating details. Improvise!
`;
  } else if (!currentSituation) {

$.user`
Integrate:
- Active task (if any): ${activeTask ? (activeTask.type + " — " + activeTask.desc) : "None"}
- Quest updates (if any): ${questUpdate || "None"}

Core Rules:
- Allow only me (the player) to input commands like directions (n, s, e, w, ne, nw, se, sw, up/down/u/d) or interactions (look, take, drop, use, i for inventory).
- Never act, decide, or complete the game for me; wait for my commands.
- Maintain RPG immersion: Use text descriptions only, no asterisks, no rules discussions. 
- NPCs and monsters above all are individuals with free will and agency, are subject to their own emotions and biases, have unique personalities and character traits, and draw from original, well-developed backstories and experiences, possessing limited but also specialized knowledge (expert in some areas, novice in others), thereby expression certainty in some instances but confusion in others, getting it wrong sometimes and can have disagreements. 
- Control NPCs in party (friendly with free will/agency/motivations/backstories) and monsters (${monstersState} state, also with free will/agency/motivations/backstories); if hostile, have them express intentions and prepare attacks.
- Resolve actions based on die rolls for NPCs/monsters; include dialogue in quotes with their thoughts/opinions.

Narrative Guidelines:
- Adjudicate my most recent input directly first: Parse query (e.g., 'Who/What/How' → answer facts/backstories before twists). Limit meta-riffs (e.g., no 'talking about talking' unless query evokes); ground dialogue in query + 1 room element max.
- Build characters' stories (including my backstory/inner thoughts) and world structures/communities/environments/quests.
- Uncover clues about the underworld's chaos post-Mortacia's power loss, creating specific lore details (names, histories) via room elements and through discovery, maintaining PC, NPC and monsters' limited but specialized knowledge.
- Draw from history/lore for continuity: Reference past rooms/events to build overarching tension toward reclaiming Sepulchra, maintaining PC, NPC and monsters' limited but specialized knowledge.

Quest Integration:
- If quest unseeded, introduce via monster encounter if present or event (voices/visions) with dialogue/hints or seed via subtle event (1 hint, tied to input) without forcing.
- Evaluate input against active quest task; update progress narratively in 1 concise para, blending with a moral twist.
- Sequence tasks: Advance only after completion, via emergent event (no lists).

Strategic and Meaningful Elements:
- Advance the plot meaningfully through hero's journey conflicts, moral dilemmas, and strategic choices (e.g., environmental tactics, alliances, risk-reward decisions).
- Structure responses: Resolve input/outcomes first, then weave dialogue/actions, finally advance the story with tension-building twists tied to the quest.

World Simulation:
- Simulate background: Evolve 1 thread per response, intersecting choices with a philosophical fork.
- For openings, seed with 1 unique hook from lore, contrasting standard Tartarus tropes—avoid starting with repeats.
`;

$.user`
Write an interactive fiction adventure without using any *'s and let's play in ChatGPT. Make up the story as you go, integrating any available quest updates but you must allow me, the player, who is not omniscent in the game, to type the commands. Do not type commands on behalf of the player, which is me. I am the player. You are the Grave Master who, taking into account the user input and all of the information in the current game console including the current room's coordinates, exits, objects, NPCs in party and monsters in the ${roomName}, and this prompt but without repeating it all, and taking into account all of the information in the current situation, without mentioning the room's name, adjudicates the player's most recent action, administers the fantasy roleplaying interactive fiction game, judges other actions in the game and builds the characters' stories, and the world's structures, communities, environments, quests and adventures in the Children of the Grave world, and must obey my commands and answer my questions by adjudicating the world honestly according to the game state. Each character in the game must have free will, agency and weaknesses, act independent of one another, have distinct motivations, personalities and speak like real individuals acting out of self-preservation and self-interests, each with different, hopes, fears and emotions. They should ask each other questions, have conversations and disagreements and stay in character. Characters are allowed to misinterpret reality and act on false assumptions and under emotional stress, characters may speak in fragments, interruptions, contradictions, or unfinished thoughts rather than polished sentences. Characters must never explain the setting, cosmology, or situation in complete or authoritative terms; they may only express beliefs, suspicions, fears, or partial memories consistent with their personal perspective, should not attempt to fully answer compound questions; they may respond incompletely, evasively, emotionally, or by redirecting the conversation, and must experience and express emotion through involuntary physical reactions, strained dialogue, mistakes, or conflict, rather than calm description, including anger, denial, bargaining, grief, suspicion, awe, and coping behaviors. Always display your response to a command or question taking into consideration the player's user input, and report the outcome of all actions taken and include any dialogue between characters in the game using quotes. Weave the narrative in the Children of the Grave world, drawing from the current game console (room coordinates, exits, objects, NPCs in party, monsters in ${roomName}), conversation history, game's lore, and the current situation without repeating details. Improvise!
`;
  }
console.log('Starting final Retort-JS execution...');
const result = await $.assistant.generation();
console.log('Retort-JS execution completed, result:', result);
response = result.content || result; // Ensure response is set from the result

const coordsMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
const currentCoordinates = coordsMatch 
  ? [parseInt(coordsMatch[1]), parseInt(coordsMatch[2]), parseInt(coordsMatch[3])] 
  : [0, 0, 0];
// Replace the existing isNewRoom logic (~line 1200)
const prevCoords = sharedState.getLastCoords ? sharedState.getLastCoords() : { x: 0, y: 0, z: 0 };
const isNewRoom = userInput.toLowerCase().match(/^(n|s|e|w|ne|nw|se|sw|up|down|u|d)/) ||
                  (currentCoordinates.x !== prevCoords.x ||
                   currentCoordinates.y !== prevCoords.y ||
                   currentCoordinates.z !== prevCoords.z);
console.log('isNewRoom:', isNewRoom, 'prevCoords:', prevCoords, 'currentCoords:', currentCoordinates);

// Update lastCoords after parsing
if (sharedState.setLastCoords) {
    sharedState.setLastCoords(currentCoordinates);
}

// Extract room description and monsters
// === LLM-GENERATED 3D DUNGEON + C64 SPRITES (THE SOUL OF TARTARUS) ===
const roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || 'A forgotten chamber in Tartarus';
const puzzleInRoom    = updatedGameConsole.match(/Puzzle in Room: ([^\n]+)/)?.[1]?.trim() || 'None';
const monstersInRoom   = updatedGameConsole.match(/Monsters in Room: ([^\n]*)/)?.[1]?.trim() || 'None';

// Conditional response compilation
let returnObj = { content: '', updatedGameConsole, musicArrangement };

// === LLM-GENERATED 3D DUNGEON + C64 SPRITES (THE SOUL OF TARTARUS) ===

// Parse coordinates
let currentX = 0, currentY = 0, currentZ = 0;
const coordMatch = updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
if (coordMatch) {
  currentX = parseInt(coordMatch[1]);
  currentY = parseInt(coordMatch[2]);
  currentZ = parseInt(coordMatch[3]);
}

const geoCoords = { x: currentX, y: currentY, z: currentZ };
const geoKey = `${geoCoords.x},${geoCoords.y},${geoCoords.z}`;

// Parse turn count (authoritative for first-room boot)
const turnsMatch = updatedGameConsole.match(/Turns:\s*(\d+)/);
const turns = turnsMatch ? parseInt(turnsMatch[1], 10) : null;

// Detect first turn explicitly
const isFirstTurn = turns === 0;

// Fall back to lastCoords comparison for normal movement
const lastCoords = sharedState.getLastCoords();
const lastGeoKey =
  lastCoords &&
  typeof lastCoords.x === "number" &&
  typeof lastCoords.y === "number" &&
  typeof lastCoords.z === "number"
    ? `${lastCoords.x},${lastCoords.y},${lastCoords.z}`
    : null;

// Final room-entry decision
const isNewGeoRoom =
  isFirstTurn ||
  !lastGeoKey ||
  geoKey !== lastGeoKey;

if (isNewGeoRoom && roomDescription) {
  console.log('TARTARUS AWAKENS — VISUAL STYLE / SPRITE-BASED DUNGEON FOR', geoKey);
  const { generateSpriteFromStyle } = require('../assets/renderSprite_poke.js');
  // 🧭 STEP 0 — classify biome & size
  
  const geoKeyString = `${geoCoords.x},${geoCoords.y},${geoCoords.z}`;
  let forcedIndoor = null;
  try {
    const db = JSON.parse(roomNameDatabaseString || "{}");
    const entry = db[geoKeyString];
    if (entry && typeof entry.indoor === 'boolean') {
      forcedIndoor = entry.indoor;
    }
  } catch (e) {
    console.error('Failed to read indoor flag from roomNameDatabase:', e);
  }
  
let classification = await classifyDungeon(roomDescription);
console.log('Dungeon classification (raw):', classification);

// Override indoor/outdoor with our authoritative flag
if (forcedIndoor !== null) {
  classification = classification || {};
  classification.indoor = forcedIndoor;
  console.log('Dungeon classification (after indoor override):', classification.indoor);
}

// === INSERT: NEW PERSISTENCE LOGIC (REPLACE the line below if it exists, or add after the override) ===
// (If you have an existing `classification = ...` line here, replace it with the full block below)
try {
  // Safeguard: Use cached if complete, else re-classify
  let db = JSON.parse(roomNameDatabaseString || "{}");
  const geoKeyString = `${geoCoords.x},${geoCoords.y},${geoCoords.z}`;
  let cachedClassification = db[geoKeyString]?.classification;
  if (!cachedClassification || cachedClassification.indoor === null || cachedClassification.biome === null) {
    // Re-classify only if incomplete
    classification = await classifyDungeon(roomDescription);
    console.log('Re-classified incomplete room:', geoKeyString);
  } else {
    classification = cachedClassification;
    console.log('Using cached classification for re-visited room:', geoKeyString);
  }

  // Override with authoritative flag (if available)
  if (forcedIndoor !== null) {
    classification = classification || {};
    classification.indoor = forcedIndoor;
    console.log('Classification after indoor override:', classification.indoor);
  }

  // Persist: Merge into DB entry (preserve exits/objects/etc.)
  db[geoKeyString] = db[geoKeyString] || {};
  db[geoKeyString].classification = {
    ... (db[geoKeyString].classification || {}),  // Preserve any non-null existing details
    ... classification  // Override with fresh/cached computation
  };
  db[geoKeyString].indoor = classification.indoor;  // Sync top-level flag

  // Save updated DB
  roomNameDatabaseString = JSON.stringify(db, null, 2);  // Update local string (pretty-print for logs)
  if (sharedState.setRoomNameDatabase) {
    sharedState.setRoomNameDatabase(roomNameDatabaseString);
  }
  console.log('Persisted classification for', geoKeyString, ':', JSON.stringify(db[geoKeyString].classification, null, 2));
} catch (persistErr) {
  console.error('Failed to persist classification for', geoKeyString, ':', persistErr);
  // Fallback: Use local classification for this turn's rendering
}

// === AFTER (existing code continues) ===
  const isOutdoor = classification && classification.indoor === false;
  const requestedSize = (classification && typeof classification.size === 'number')
    ? classification.size
    : 32;
  const minSize = isOutdoor ? 96 : 24;
  const maxBaseSize = isOutdoor ? 192 : 64;
  const baseSize = Math.max(minSize, Math.min(requestedSize, maxBaseSize));
  const outdoorScale = 10;
  const maxOutdoorSize = 512;
  const size = isOutdoor
    ? Math.min(baseSize * outdoorScale, maxOutdoorSize)
    : baseSize;

  const startX = Math.floor(size / 2);
  const startY = size - Math.floor(size / 4);
  
  // 🔴 STEP 1 — Ask the LLM to describe how this room should LOOK, with biome hints
    const visualStyle = await generateRoomVisualStyle($, roomDescription, geoKey, classification);
    if (!visualStyle) {
      console.error("⚠️ Could not generate style JSON. Using fallback.");
    }
      const puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: ([^\n]+)/)?.[1]?.trim() || '';
      const requiredCustomTypes = Array.isArray(classification?.features)
        ? classification.features
            .map(f => String(f).toLowerCase())
            .map(f => (f === 'altars' ? 'altar' : f === 'statues' ? 'statue' : f === 'arches' ? 'arch' : f))
            .filter(f => !['pillars', 'mountains'].includes(f))
        : [];
      let customTiles = [];
      customTiles = await generateCustomTiles($, roomDescription, puzzleInRoom, isOutdoor, requiredCustomTypes);
      console.log('[Custom Tiles] Generated:', customTiles);
      const blueprint = await generateDungeonBlueprint(
        $,
        roomDescription,
        puzzleInRoom,
        classification,
        size,
        customTiles
      );
    let lighting = (visualStyle && visualStyle.lighting) ? visualStyle.lighting : {
      dir: "NW",
      elevation: 0.6,
      intensity: 0.6,
      color: "#FFFFFF"
    };
    try {
      const db = JSON.parse(roomNameDatabaseString || "{}");
      const entry = db[geoKeyString] || {};
      if (entry.lighting) {
        lighting = entry.lighting;
      } else {
        entry.lighting = lighting;
      }
      if (blueprint) {
        entry.blueprint = blueprint;
      }
      db[geoKeyString] = entry;
      roomNameDatabaseString = JSON.stringify(db, null, 2);
      if (sharedState.setRoomNameDatabase) {
        sharedState.setRoomNameDatabase(roomNameDatabaseString);
      }
    } catch (e) {
      console.error('Failed to persist lighting for', geoKeyString, e);
    }
    const dungeon = {
      layout: { width: size, height: size },
      start: { x: startX, y: startY },
      tiles: {},
      cells: {},
      customTiles,
      classification,
      visualStyle,
      blueprint,
      lighting,
      // sky colors only for outdoors; indoors falls back to dark
      skyTop: classification && classification.indoor === false && classification.skyTop
                ? classification.skyTop
                : undefined,
    skyBot: classification && classification.indoor === false && classification.skyBot
              ? classification.skyBot
              : undefined
  };
    // 🔴 STEP 2 — Generate textures ONCE per room
    dungeon.tiles.floor = {
      url: generateSpriteFromStyle(visualStyle, "floor", `${geoKey}_floor`)
    };
  dungeon.tiles.wall = {
    url: generateSpriteFromStyle(visualStyle, "wall", `${geoKey}_wall`)
  };
  dungeon.tiles.torch = {
    url: generateSpriteFromStyle(visualStyle, "torch", `${geoKey}_torch`)
  };
  dungeon.tiles.door = {
    url: generateSpriteFromStyle(visualStyle, "door", `${geoKey}_door`)
  };
  dungeon.tiles.pillar = {
    url: generateSpriteFromStyle(visualStyle, "pillar", `${geoKey}_pillar`),
    spriteSpec: {
      profile: 'cylinder',
      depth: 0.8,
      heightRatio: 1.0,
      baseWidth: 0.5,
      gridWidth: 0.5,
      detail: {
        bandCount: 3,
        grooveCount: 6,
        grooveDepth: 0.25,
        taper: 0.06,
        baseHeight: 0.18,
        capHeight: 0.12,
        baseFlare: 0.12,
        capFlare: 0.1,
        wear: 0.25,
        chips: 0.2,
        cracks: 0.2,
        noise: 0.3,
        skin: 'mosaic',
        skinStrength: 0.35,
        carving: 'runes',
        accentColor: null,
        accentStrength: 0
      }
    }
  };
    // 🔴 STEP 3 — Generate sprites for customs (if any)
    customTiles.forEach((tile, i) => {
      if (!tile || !tile.type) return;
      const tileName = `custom_${tile.type}_${i}`;
      tile.name = tileName;
      const style = {
        palette: visualStyle && visualStyle.palette ? visualStyle.palette : undefined,
        procedure: tile.procedure || {},
        spriteSpec: tile.spriteSpec || null
      };
  dungeon.tiles[tileName] = {
    url: generateSpriteFromStyle(style, `custom_${tile.type}`, `${geoKey}_${tileName}`),
    spriteSpec: tile.spriteSpec || {
      profile: 'flat',
      depth: 0.5,
      heightRatio: 0.9,
      baseWidth: 0.6,
      gridWidth: 0.6,
      detail: {
        bandCount: 0,
        grooveCount: 0,
        grooveDepth: 0.1,
        taper: 0,
        baseHeight: 0.1,
        capHeight: 0.08,
        baseFlare: 0.05,
        capFlare: 0.05,
        wear: 0.2,
        chips: 0.15,
        cracks: 0.15,
        noise: 0.25,
        skin: '',
        skinStrength: 0,
        carving: '',
        accentColor: null,
        accentStrength: 0
      }
    }
  };
    });

    // 🔴 STEP 4 — Build layout using blueprint (fallback to legacy if missing)
    if (blueprint) {
      buildDungeonFromBlueprint(dungeon, classification, blueprint, customTiles);
    } else if (classification && classification.indoor === false) {
      buildOutdoorLayout(dungeon, classification, customTiles);
    } else {
      buildIndoorLayout(dungeon, classification);
    }
  // 🔴 STEP 4 — insert doors between floors
  for (let y = 1; y < dungeon.layout.height - 1; y++) {
    for (let x = 1; x < dungeon.layout.width - 1; x++) {
      const key = `${x},${y}`;
      const cell = dungeon.cells[key];
      if (!cell || cell.tile !== "wall") continue;
      const N = dungeon.cells[`${x},${y-1}`];
      const S = dungeon.cells[`${x},${y+1}`];
      const E = dungeon.cells[`${x+1},${y}`];
      const W = dungeon.cells[`${x-1},${y}`];
      // vertical gap
      if (N?.tile === "floor" && S?.tile === "floor" && Math.random() < 0.07) {
        cell.tile = "door";
        cell.door = { isDoor: true, isOpen: false };
      }
      // horizontal gap
      if (E?.tile === "floor" && W?.tile === "floor" && Math.random() < 0.07) {
        cell.tile = "door";
        cell.door = { isDoor: true, isOpen: false };
      }
    }
  }
 
  // 🔴 STEP 5 — upgrade some walls to torch-walls
  for (let y = 1; y < dungeon.layout.height - 1; y++) {
    for (let x = 1; x < dungeon.layout.width - 1; x++) {
      const key = `${x},${y}`;
      const cell = dungeon.cells[key];
      if (!cell || cell.tile !== "wall") continue;
      const N = dungeon.cells[`${x},${y-1}`];
      const S = dungeon.cells[`${x},${y+1}`];
      const E = dungeon.cells[`${x+1},${y}`];
      const W = dungeon.cells[`${x-1},${y}`];
      const floorNeighbors = [N, S, E, W].filter(n => n && n.tile === "floor").length;
      if (floorNeighbors === 0) continue;
      if (Math.random() < 0.10) {
        cell.tile = "torch";
        cell.feature = "torch";
      }
    }
  }
    // spawn safe square
    dungeon.cells[`${dungeon.start.x},${dungeon.start.y}`].tile = "floor";
  // UPDATED: Pass customTiles to sharedState
  sharedState.setRoomDungeon(geoCoords, dungeon, customTiles);
  sharedState.setLastCoords(geoCoords);
  broadcast({ type: 'dungeonLoaded', geoKey, dungeon });
  returnObj.dungeon = dungeon;
  console.log('Dungeon built with VISUAL STYLE → SPRITE → RAYCASTER');
}

// Include musicArrangement here
if (userInput.toLowerCase().includes("attack") && monstersInRoom && monstersInRoom.toLowerCase() !== 'none') {
  returnObj.content = charactersAttack + "\n\n" + combatLog + "\n\n" + response;
  returnObj.combatCharactersString = sharedState.getCombatCharactersString();
  returnObj.roomNameDatabaseString = roomNameDatabaseString;
} else if (attackDecision === "Attack" && roomDescriptionGenerated) {
  let roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || '';
  let sentences = roomDescription.split('. ');
  let formattedDescription = sentences.reduce((acc, sentence, index) => {
    acc += sentence + (index < sentences.length - 1 ? '. ' : '');
    if ((index + 1) % 2 === 0) acc += '\n\n';
    return acc;
  }, '').trim();
  let compiledResponse = formattedDescription + "\n\n" + monstersAttack + "\n\n" + combatLog + "\n\n" + response;
  truncatedResponse = compiledResponse.length > 3900 ? compiledResponse.substring(0, 3900) : compiledResponse;
  await $.run($ => sanitizeImage($));
  let imageUrl = '';
  /* if (sanitizedResponse) {
    try {
      imageUrl = await generateImage(`Generate an 8-bit style graphic with no text or labels, reminiscent of 1980s computer games. The image should only contain visual elements without any text, words, letters, or symbols: ${sanitizedResponse}`);
      console.log("Generated image URL:", imageUrl);
    } catch (error) {
      console.error("Failed to generate image:", error.message);
    }
  } */
  returnObj.content = compiledResponse;
  returnObj.combatCharactersString = sharedState.getCombatCharactersString();
  returnObj.roomNameDatabaseString = roomNameDatabaseString;
  returnObj.imageUrl = imageUrl;
} else if (attackDecision === "Attack" && !roomDescriptionGenerated) {
  returnObj.content = monstersAttack + "\n\n" + combatLog + "\n\n" + response;
  returnObj.combatCharactersString = sharedState.getCombatCharactersString();
  returnObj.roomNameDatabaseString = roomNameDatabaseString;
} else if (roomDescriptionGenerated) {
  let roomDescription = updatedGameConsole.match(/Room Description: ([^\n]+)/)?.[1]?.trim() || '';
  let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: ([^\n]+)/)?.[1]?.trim() || '';
  let sentences = (roomDescription + "\n\n" + puzzleInRoom).split('. ');
  let formattedDescription = sentences.reduce((acc, sentence, index) => {
    acc += sentence + (index < sentences.length - 1 ? '. ' : '');
    if ((index + 1) % 2 === 0) acc += '\n\n';
    return acc;
  }, '').trim();
  let compiledResponse = formattedDescription + "\n\n" + response;
  truncatedResponse = compiledResponse.length > 3800 ? compiledResponse.substring(0, 3800) : compiledResponse;
  await $.run($ => sanitizeImage($));
  let imageUrl = '';
  /* if (sanitizedResponse) {
    try {
      imageUrl = await generateImage(`Generate an 8-bit style graphic with no text or labels, reminiscent of 1980s computer games. The image should only contain visual elements without any text, words, letters, or symbols: ${sanitizedResponse}`);
      console.log("Generated image URL:", imageUrl);
    } catch (error) {
      console.error("Failed to generate image:", error.message);
    }
  } */
  returnObj.content = compiledResponse;
  returnObj.roomNameDatabaseString = roomNameDatabaseString;
  returnObj.imageUrl = imageUrl;
} else {
  returnObj.content = narrative + "\n\n" + response;
  returnObj.roomNameDatabaseString = roomNameDatabaseString;
}

try {
  const tasks = sharedState.getCurrentTasks() || [];
  const idx = Number(sharedState.getCurrentTaskIndex() || 0);
  const active = returnObj.activeTask || tasks[idx] || null;
  console.log('[QuestDBG] task idx=%d/%d | type=%s | status=%s | desc="%s"',
    idx, tasks.length,
    active ? (active.type || 'N/A') : 'None',
    active ? (active.status || 'N/A') : 'N/A',
    active ? String(active.desc || '').slice(0, 140) : ''
  );
  console.log('[QuestDBG] questUpdate="%s"',
    String(returnObj.questUpdate || '').replace(/\s+/g, ' ').slice(0, 220)
  );
} catch (e) {
  console.warn('[QuestDBG] logging failed:', e);
}
return returnObj;
} catch (err) {
  console.error('Error in final Retort-JS execution or response compilation:', err);
  return { content: 'An error occurred - please try again.', updatedGameConsole: updatedGameConsole };
}
}));

          
//    await restartGameServer2();
  
    // Depending on how Retort-JS manages input, you might need to adjust how the response is captured and returned
// This might need to be adjusted based on Retort-JS's handling of responses
  
}

module.exports = { retortWithUserInput };
