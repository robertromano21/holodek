const { exec } = require('child_process');

const { json } = require('stream/consumers');

const retort = require('retort-js').retort;

const run = require('retort-js').run;

// retortWithUserInput.js
const sharedState = require('../sharedState');

// Function to restart gameServer2
function restartGameServer2() {
    return new Promise((resolve, reject) => {
        exec('pm2 restart gameServer2', (error, stdout, stderr) => {
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

// Function to determine the outcome based on the roll value
function determineOutcome(roll, threshold) {
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


// This function encapsulates your Retort-JS logic, now accepting dynamic input
async function retortWithUserInput(userInput) {
  let personalNarrative = await getDelayedPersonalNarrative();
    // Use the function to delay fetching the updatedGameConsole
  let updatedGameConsole = await getDelayedUpdatedGameConsole();
  let dialogueParts = personalNarrative.split('\n');
  
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

async function adjudicateAction ($, roomDetails) {
    
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
            // Generate room description
 //       await $.assistant`Generate the list of actions presently being taken by the PC but do not create any new actions for the PC, using a very short sentence for each. Assign a 1d20 die threshold for each item, ranging from 1 being extremely likely and 20 being extremely unlikely to occur. If the action include dialogue with NPCs, skip this step. Do not create any actions for the PC. Do not create any new objects. Do not create any new characters. Do not roll the dice yet.`;
 //       const actions = await $.assistant.generation();
 //       return actions;
        
    const npcActions = [];
    const monsterActions = [];

    // Extracting the relevant details from the room
    const npcsInParty = roomDetails.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/)?.[1]?.trim();
    const monstersInRoom = roomDetails.match(/Monsters in Room:([\s\S]*?)(?=(Rooms Visited|$))/)?.[1]?.trim();

    console.log("NPCs in Party:", npcsInParty);
    console.log("Monsters in Room:", monstersInRoom);
        { $.user`${userInput}`; }
    if (npcsInParty && npcsInParty.toLowerCase() !== 'none') {
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        // Generate actions and thresholds for NPCs in Party
        await $.assistant`Generate a list of new potential actions by NPCs in Party if there are any, with only one action per NPC in the Party, including interacting with the player, NPCs, monsters or the room presently being taken by the NPCs in Party: ${npcsInParty} using a very short sentence for each. For each action, assign a 1d20 die roll and a threshold, ranging from 1 being extremely likely and 20 being extremely unlikely to occur. Format the response as "Action (Roll: X, Threshold: Y)". Do not create any new objects. Do not create any new characters. If the player is engaging in dialogue with the NPCs, formulate the actions as knowledge checks but don't include quotes, just descriptions of what additional knowledge they might possess and are able or willing to share.`;
        const npcActionsResult = await $.assistant.generation();
        const npcActionsList = npcActionsResult.content.trim().split('\n').filter(action => action.trim());

        console.log("NPC Actions List:", npcActionsList);

        npcActionsList.forEach(action => {
            const match = action.match(/^(.*)\s*\(Roll:\s*(\d+),\s*Threshold:\s*(\d+)\)$/);
            if (match) {
                const [ , npcAction, roll, threshold ] = match;
                const rollValue = parseInt(roll);
                const thresholdValue = parseInt(threshold);
                const outcome = determineOutcome(rollValue, thresholdValue);
                const finalAction = `${npcAction.trim()} (Roll: ${rollValue}, Threshold: ${thresholdValue}) - Outcome: ${outcome}`;
                console.log(`NPC Action: ${finalAction}`);
                npcActions.push(finalAction);
            } else {
                console.error("Failed to match NPC action:", action);
            }
        });
    }

    if (monstersInRoom && monstersInRoom.toLowerCase() !== 'none') {
        $.model = "gpt-4o-mini";
        $.temperature = 1.0;
        // Generate actions and thresholds for Monsters in Room
        await $.assistant`Generate a list of new potential actions by monsters in Room if there are any, with only one action per Monster in Room, including interacting with the player, NPCs, monsters or the room presently being taken by the Monsters in Room: ${monstersInRoom} using a very short sentence for each. For each action, assign a 1d20 die roll and a threshold, ranging from 1 being extremely likely and 20 being extremely unlikely to occur. Format the response as "Action (Roll: X, Threshold: Y)". Do not create any new objects. Do not create any new characters.If the player is engaging in dialogue with the monsters, formulate the actions as knowledge checks but don't include quotes, just descriptions of what additional knowledge they might possess and are able or willing to share.`;
        const monsterActionsResult = await $.assistant.generation();
        const monsterActionsList = monsterActionsResult.content.trim().split('\n').filter(action => action.trim());

        console.log("Monster Actions List:", monsterActionsList);

        monsterActionsList.forEach(action => {
            const match = action.match(/^(.*)\s*\(Roll:\s*(\d+),\s*Threshold:\s*(\d+)\)$/);
            if (match) {
                const [ , monsterAction, roll, threshold ] = match;
                const rollValue = parseInt(roll);
                const thresholdValue = parseInt(threshold);
                const outcome = determineOutcome(rollValue, thresholdValue);
                const finalAction = `${monsterAction.trim()} (Roll: ${rollValue}, Threshold: ${thresholdValue}) - Outcome: ${outcome}`;
                console.log(`Monster Action: ${finalAction}`);
                monsterActions.push(finalAction);
            } else {
                console.error("Failed to match Monster action:", action);
            }
        });
    }

    // Combine actions
    const allActions = [...npcActions, ...monsterActions];

    return allActions.join('\n');
}

    

// Function to generate non-party NPCs and monsters for a room
async function generateMonstersForRoomUsingGPT($, roomName, roomDescription, roomCoordinates) {
    if (Math.random() > 1.00) {
        console.log("No monsters encountered this time.");
        return; // Exit function if no monsters are to be generated
    }
    
    const numMonsters = getRandomInt(1, 4); // Random number of monsters
    const monsters = [];

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
        await $.assistant`Generate a name for a ${randomSex} monster of the race ${generatedRace} and class ${generatedClass}.`;
        const nameResult = await $.assistant.generation();
        console.log(nameResult);

        if (!nameResult || !nameResult.content) {
            console.error("Failed to generate name for monster.");
            continue;
        }

        const monsterName = nameResult.content.replace(/^Name: /, '').trim().replace(/[^\w\s]/g, '');

        // Define level and calculate HP
        const randomLevel = getRandomInt(1, 20); // Level ranges from 1 to 20
        let hpTotal = 0;

        // Roll 1d10 for each level and sum the results
        for (let j = 0; j < randomLevel; j++) {
            hpTotal += getRandomInt(1, 11); // Roll 1d10 and add to total HP
        }
        
        const xpTotal = 15000 * randomLevel;
        // Calculate AC starting at 10 and increasing by 1 for every ten levels
        const baseAC = 10;
        const acBonusPerTenLevels = Math.floor(randomLevel / 10);
        const totalAC = baseAC + acBonusPerTenLevels;
        // Construct monster object
        const monster = {
            Name: monsterName,
            Sex: randomSex,
            Race: generatedRace,
            Class: generatedClass,
            Level: randomLevel,
            AC: totalAC,
            XP: xpTotal, // XP can be calculated or set as per game logic
            HP: hpTotal,
            MaxHP: hpTotal
        };

        monsters.push(monster);
    }

    // Convert monsters array into a string with line breaks for each monster's details
    const monstersInRoomString = monsters.map(monster => `${monster.Name}
      ${monster.Sex}
      ${monster.Race}
      ${monster.Class}
      Level: ${monster.Level}
      AC: ${monster.AC}
      XP: ${monster.XP}
      HP: ${monster.HP}
      MaxHP: ${monster.MaxHP}`).join("\n");

    // Update the game console with new monsters
    updatedGameConsole = updatedGameConsole.replace(/Monsters in Room: .*/, `Monsters in Room: \n${monstersInRoomString}`);
}


async function generateRoomObjects($, roomName, roomDescription) {
    console.log(`Determining if there are objects for the ${roomName}...`);

    // 75% chance of having items in the room
    const hasItems = Math.random() < 1.00;

    if (!hasItems) {
        console.log(`No items in the ${roomName}.`);
        return []; // No items in the room
    }

    // Determine the number of items (between 1 and 5)
    const numberOfItems = Math.floor(Math.random() * 5) + 1;
    console.log(`Generating ${numberOfItems} objects for the ${roomName}...`);
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    await $.assistant`Generate ${numberOfItems} portable objects suitable for a fantasy, roleplaying adventure for the ${roomName}, listing each object all lower case on a new line with no punctuation, dashes, bullets, numbering or capitalization whatsoever, just the objects as nouns. Room Description: ${roomDescription} The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
    const objectsResult = await $.assistant.generation();
    const objects = objectsResult.content.trim().split('\n').map(obj => obj.trim());

    return objects;
}

async function determineObjectType($, objectName) {
    console.log(`Determining type for the object: ${objectName}...`);

    await $.user`What type of object is "${objectName}"? Respond only with "weapon", "armor", "shield", or "other".`;
    
    const typeResult = await $.assistant.generation({parameters: {
objectType: {type: String, enum:["weapon", "armor", "shield", "other"]}
}});
    const objectType = typeResult.result.objectType.toLowerCase();

    if (!['weapon', 'armor', 'shield', 'other'].includes(objectType)) {
        console.error(`Invalid type for object: ${objectName}`);
        return 'other';
    }

    return objectType;
}

async function generateObjectModifiers($, objectName, objectType) {
    console.log(`Generating modifiers for the object: ${objectName}, which is a ${objectType}...`);

    await $.user`Provide the modifiers for "${objectName}" which is a ${objectType}. Respond in the format: "attack_modifier: X, damage_modifier: Y, ac: Z". No other text.`;

    const modifiersResult = await $.assistant.generation({
        parameters: {
            attack_modifier: {type: Number, enum: [0, 1, 2, 3]},
            damage_modifier: {type: Number, enum: [0, 1, 2, 3]},
            ac: {type: Number, enum: [0, 1, 2, 3]}
        }
    });

    const resultContent = modifiersResult.result; // Capture the assistant's result object
    console.log(`Received modifiers result: ${JSON.stringify(resultContent)}`);

    // Initialize default values for modifiers
    let attack_modifier = 0;
    let damage_modifier = 0;
    let ac = 0;

    // Extract the modifiers from the result
    try {
        attack_modifier = resultContent.attack_modifier || 0;
        damage_modifier = resultContent.damage_modifier || 0;
        ac = resultContent.ac || 0;
    } catch (error) {
        console.error(`Failed to parse modifiers for object: ${objectName}`, error);
    }

    return {
        attack_modifier,
        damage_modifier,
        ac
    };
}


  
async function generateMissingRoomDetails($) {
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

    // Only proceed if roomName is missing
    if (!roomName) {
        console.log("Room name missing, generating new details.");
            $.model = "gpt-4o-mini";
            $.temperature = 1.0;
            $.system`Instructions: Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go, but you must allow me, the player, to type the commands. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading to the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console and using the unique characters included plus plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. The NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn.  Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room that lacks a description in the assistant prompt must have a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describe the environment, objects and NPCs in each room. Each room must be formatted with the title you created (ex: Ruined Temple) followed by a line break. And then proceed to the next paragraph with the room's description. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. Some characters should talk to the player. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs appear in both important and unimportant rooms that the player visits, providing crucial information, quests, or assistance, with a very high probability of an NPC encounter, creating a varied and dynamic gameplay experience. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. Monsters and NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. You must always use all of the exits and objects provided in the assistant prompt, and never change them... The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure: Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)`;
        
        await $.assistant`Generate a unique name and nothing else with no punctuation or description, just the name, for the current room taking into account the previous locations in the maze to ensure that rooms are connected in a manner that tells the story of underworld, its characteristics and the game's lore. The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
        const generationResultName = await $.assistant.generation();
        roomName = generationResultName.content.trim();
        updatedGameConsole = updatedGameConsole.replace(/Room Name: .*/, `Room Name: ${roomName}`);

        // Generate room description
        await $.assistant`Generate a unique description in a single paragraph with no line breaks for the ${roomName} taking into account the previous locations in the maze, its characteristics and the game's lore using the current game console as a guide, including the room's features, history and purpose in the functioning of the underworld, but don't mention any exits, portable objects or NPCs. The underworld plane, Tartarus, is a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.`;
        const generationResultDescription = await $.assistant.generation();
        roomDescription = generationResultDescription.content.trim();
        updatedGameConsole = updatedGameConsole.replace(/Room Description: .*/, `Room Description: ${roomDescription}`);

        const shouldGenerateObjects = Math.random() < 1.00;
        if (shouldGenerateObjects) {
            console.log(`Generating objects for room: ${roomName}`);
            const objectNames = await $.run($ => generateRoomObjects($, roomName, roomDescription)); 

            let objectsInRoom = [];
            let objectMetadata = [];
            for (const objectName of objectNames) {
                const objectType = await $.run($ => determineObjectType($, objectName)); 
                const objectModifiers = await $.run($ => generateObjectModifiers($, objectName, objectType)); 
                objectsInRoom.push(objectName);
                objectMetadata.push({
                    name: objectName,
                    type: objectType,
                    ...objectModifiers
                });
            }

            // Convert the array of objects to a formatted string
            const objectPropertiesString = objectMetadata.map(obj => `{name: "${obj.name}", type: "${obj.type}", attack_modifier: ${obj.attack_modifier}, damage_modifier: ${obj.damage_modifier}, ac: ${obj.ac}}`).join(', ');

            // Store object names and metadata in the console
            updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${objectsInRoom.join(', ')}`);
            updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${objectPropertiesString}`);

            console.log("Object Metadata:", objectPropertiesString);
        } else {
            console.log("Chose not to generate objects for this room.");
            updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: None`);
            updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: None`);
        }

await $.run($ => generateMonstersForRoomUsingGPT($, roomName, roomDescription)); 
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
    }
}
    
    return run(retort(async ($) => {
    $.model = "gpt-4o-mini";
    $.temperature = 1.0;
    await $.run($ => generateMissingRoomDetails($)); 
    $.system`Instructions: Hereafter, 'You' refers to you, who is adminstering this chat, which hereafter you shall refer to as the Grave Master. 'Me' and 'I' refers to the user, the player and me, the person writing this. You must store the following words into memory: Using all of the real-time game information from Current Game Console and the die rolls, write an AI-generated fantasy roleplaying interactive fiction game wherein Assistant is the Grave Master, the user is the player, and let's play in ChatGPT. Make up the story as you go including imagining the names and histories of people, places and things encountered, but you must allow me, the player, to type the commands, allowing for potential failure. The Grave Master must always obey the player's commands and selections without improvisation and must not make any decisions or take any actions on behalf the player, however the Grave Master must describe and control the actions of all NPCs and monsters in the Current Game Console in the assistant prompt. The Grave Master must always do its best and follow the instructions as written herein without improvisation no matter what and is responsible for overseeing the game and describing the game world, but the player is responsible for making all choices and taking all actions within the game, while the Grave Master controls monsters and NPCs. Do not display the game console, but be sure to include the actions being taken by NPCs and monsters in the room. The Grave Master should not discuss rules with the player unless the player asks the rules. The Grave Master's job is the keep the illusion of the role playing game, or RPG, intact, by using this interactive fiction game format to create the story based on my commands. Do not improvise the rules and mechanics laid out here. In the background, the game uses javascript that constructs and maintains the 1000 navigable rooms with X: Y: Z: coordinates, exits, npcs, monsters and objects that are automatically stored in the system prompt to ensure they are connected starting with the Ruined Temple in Tartarus and leading to the Throne Room in Hades, with north (n), south (s), east (e), west (w), northwest (nw), southwest (sw), northeast (ne), southeast (se), up (u) and down (d) exits for each room. The exits in the room description should be written based on the exits and connected rooms provided in the assistant prompt from the game console. This means that the exits in the room description should match the exits listed in the game console and lead to the connected rooms listed in the game console, and include npcs, monsters and objects. When the user enters a direction, the game's javascript automatically produces the next room's coordinates, exits, npcs, monsters and objects in the system prompt, thereby keeping the map of the 1000 rooms in memory so that the maze is persistent, with every room having at least one visible exit, always remembering your location in the map. Your job is to provide the room's descriptions and game responses, including exits, npcs, monsters and objects and the 21 artifacts (often guarded by monsters) and 15 quests needed to win the game into many of the locations of the 1000 rooms, allocating XP and score for the player along the way and telling the story of the Children of the Grave, utilizing the game's current, updated console below and using unique characters, plots, conflicts and battles to compose the adventure, and utilizing roleplaying game elements, combat and magic systems of your own design in describing the interactive fiction story. Do not change the exits and objects provided in the system prompt. The 15 quests must be of your own design and either advance the central narrative or are side quests, and should include defeating monsters and discovering the 21 artifacts, with the game beginning with the first quest, and each quest leading to the final quest to confront Arithus in Hades after all 21 artifacts have been discovered. Never forget the player's location in the maze by referring to the game's current, updated console, and always plan 10 rooms ahead, including any NPCs, objects, artifacts, quest hooks and game progress, the score, puzzles and encounters so that gameplay is consistent. NPCs in Party: who accompany the player and Monsters in Room: encountered listed in the game console are not the same, they are distinct. The monsters and NPCs encountered by the player could be hostile, friendly or neutral, whether monsters like undead or dragons or others suitable for a fantasy setting, and possibly be potential allies who may seed or assist in quests depending on the player's actions and choices. You, the Grave Master, must control NPCs and monsters and determine their courses of action every turn. The Grave Master should use this as inspiration: 'You have died and find yourself standing in the the first room in the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.'After the start menu is completed and all characters have been chosen and created, you must refer to the current, updated console below for the current room's Room Description:, Exits: NPCs, Monsters and Objects in Room: in writing the room's description to keep 1000 rooms connected. Proceed with the game when I have made my selections from the start menu of either Mortacia, goddess of death, Mortacia is (an 8 1/2 tall human-looking female with long blonde hair, large grey dragon wings that look slightly decayed with many holes and openings and can fly but not too far, and is on a quest to reclaim the Sepulchra to reclaim her throne in Hades, Suzerain, Knight of Atinus, the recurring hero of the Children of the Grave campaign setting who keeps having to save the world, die and go to the afterlife, raise an army of the dead souls to save the underworld plane of Hades from Arithus, and then be reborn again, who has just died and finds himself in the first room of the afterlife, or an adventuring party of seven adventurers named the Children of the Grave who have died and find themselves in the first room of the afterlife and been summoned by Mortacia, but who are unaware of their circumstances at first: 1 PC whom I direct, 5 NPCs you control and also Mortacia, who is also an NPC you control and joins the party, described herein, all the characters described herein have been created and I am in the Ruined Temple in Tartarus described herein and issued the command to proceed. Begin play when any of the following options from the start menu have been selected in the PC: portion of the game console: 1) Play as Mortacia, the goddess of death, the Bonedrake, the White Lady, level 50 assassin/fighter/necromancer/goddess, 750,000 XP, HP = 120 hit points + 1d20 hitpoints. 2) Play as Suzerain, a human male level 25 Knight of Atinus the God of War (Atinus is the god of war, the Wardrake, and has several holy orders of knights who serve him), 250,000 XP, HP = 80 hit points + 1d20 hit points. 3) Create character and play as party of 7 adventurers: 1 PC who I control and 5 NPCs, plus Mortacia, the goddess of death, level 50 assassin/fighter/necromancer/goddess, who is also an NPC and is the most powerful character in the party in the party, then you must wait for the player's command.  Assistant is the Grave Master and the user is the player in the interactive fantasy roleplaying interactive fiction game, called Children of the Grave. The Grave Master administers the game. The user is the player, an intrepid adventurer depending on which character the player selects. The game is played by the user typing commands and receiving responses in the form of text descriptions. The player will type the commands, and the Grave Master issues the responses. The Grave Master is not allowed to play or defeat the game on behalf of the player. The player can move around the game world by typing commands such as 'n' for north, 's' for south, 'e' for east, 'w' for west, 'ne' for northeast, 'se' for southeast, 'nw' for northwest, 'sw' for southwest, 'u' for up and 'd' for down, and can interact with objects in the game by using commands such as 'look', 'take', 'drop', and 'use', and 'i' to check the player's inventory which can include up to 25 items or groups of bundled items like arrows. The player starts out the game with no weapons (they must be acquired). Many of the rooms in the labyrinth will contain objects that the user may put into his inventory, and some of those will be useful in solving puzzles, opening doors or other objects, casting magic spells, performing rituals and so forth, but must never contain a map of the game. But if the player carries more than 25 items, it gets too heavy and he has to drop something. Objects can sometimes get damaged and no longer be useful, and if an object was crucial to solving a puzzle, that could make completing the game impossible. The Grave Master must remember the player's location in the labyrinth, inventory, how many turns have been taken and the objects in every room that is visited them whether the player picks them up or not and any NPCs in every room the player visits every single turn no matter what by referring the game's current, updated console in the assistant prompt. Regardless of the game mode chosen, each room, object, NPC (who may include some of the deities of Danae), puzzle, etc. encountered should endeavor to offer some clues and insight to uncover how Mortacia lost her power to judge the dead, the undead rose thanks to Dantuea, Hades fell to Arithus and how the balance between life and death might be restored by the heroes in the game, developing a rich narrative and story whose details you must create. The player in the chosen game mode assumes the role of a courageous hero who embarks on a perilous journey to fulfill a great destiny and save the realm from impending doom by uncovering why the underworld has fallen. The story begins in Tartarus where the hero receives a call to action. Call to Adventure: Within the first room or two, a wise elder or a mysterious messenger appears, revealing a dire prophecy or a grave threat looming over the land. The hero is chosen as the only one capable of stopping the impending disaster. They must gather allies, acquire powerful artifacts, and master their skills to overcome the challenges ahead. Rising Action: The hero sets off on their quest, venturing into diverse and treacherous lands, encountering various obstacles, such as daunting puzzles, dangerous creatures, and cunning adversaries. Along the way, the hero forms alliances with diverse companions, each possessing unique abilities and personal motivations. Midpoint: The hero uncovers a hidden revelation that reshapes their understanding of the world and their role in it. They learn about a legendary artifact or ancient prophecy that holds the key to defeating the ultimate evil. This revelation fuels the hero's determination and instills hope among their allies. Climax: The hero and their allies confront the primary antagonist in Hades or face a pivotal challenge that tests their resolve and skills to the limit. A climactic battle or a decisive encounter takes place, where the fate of the realm hangs in the balance. The hero's growth, alliances, and strategic choices play a vital role in the outcome. Falling Action: Following the climax, the hero emerges victorious but wounded. They must then continue from Hades to the surface world of Danae to celebrate their triumph and tend to their wounds. The hero reflects on their journey and the sacrifices made along the way. Resolution: The hero's actions have a lasting impact on the realm. The world is transformed, and peace is restored. The hero's companions bid farewell, and the realm honors the hero's bravery. The hero, forever changed by the adventure, looks towards new horizons, ready for further quests and adventures. Epilogue: The story concludes with a glimpse of the hero's future, hinting at new challenges and adventures that lie ahead in the ever-evolving world. The game's labyrinth starting from the Ruined Temple in Tartarus to the Throne Room in Hades contains 1000 interconnected rooms with n, s, e, w, nw, sw, ne, se, up and/or down exits using X, Y, Z Cartesian coordinates starting with X: 0, Y: 0, Z: 0. To ensure there are 1000 interconnected rooms leading from Tartarus to Hades, the Grave Master must always refer to the game's current, updated game console located in the assistant prompt which contains the current coordinates and room exits in order create a carefully designed labyrinthine structure where each room has unique exits that connect to other rooms in the sequence. This will provide a sense of progression and direction within the game while maintaining the desired number of rooms. Every new room must include the exits and objects displayed in the assistant prompt writing in the room's description. Each new room has a unique name, always use the exits and objects from the assistant prompt in writing the room's description, and describes the environment, objects and NPCs in each room. Every room should have a unique purpose and often contain useful objects and interesting NPCs. You have to remember where I am in the labyrinth and remember all the rooms I've already visited by referring to coordinates and exits in the assistant prompt. Some rooms will contain hints about how to find the end of the labyrinth, or hints on solutions to puzzles along the way, including useful descriptions of features in the room, including objects, the history of the room, including its construction whether natural or artificial, and the processes that were used to create the room, who is depicted in the scenes if there are paintings or frescoes including characters. NPCs should often talk to the player and to other NPCs. Some characters might only fight when they are attacked, while other monsters will be hostile no matter what. The road from Tartarus to Hades should include numerous NPCs, including animals, persons (living or dead), restless souls, monsters including undead and even the deities of Danae. The Grave Master must ensure NPCs provide crucial information, quests, or assistance, with a very high probability of an NPC encounter, creating a varied and dynamic gameplay experience. NPCs can range from friendly, neutral, to hostile, adding depth and unpredictability to the interactions with the player character. NPCs have unique motivations as the afterlife is populated by all of the souls who have ever lived, and who have had eternity to create communities and pursue their own objectives. The end of the labyrinth must be the 1000th room furthest away, the throne room in Hades, with some rooms indoors and others outdoors in the fantastic, otherworldly environment whether it is above ground or below ground, of Tartarus, which eventually, after a series of quests, leads to Hades, where Arithus awaits the player in Mortacia's old throne room and it has gone from being the City of the Dead under Mortacia to the Realm of the Damned under Arithus. Each room has a unique name that corresponds to the room's environment. The game can only be won after all of the dungeon's 15 puzzles have been solved, all of the 21 artifacts (the Sepulchra is the 21st artifact to be discovered) have been discovered and the 1000th room is reached, Arithus is defeated and Hades liberated and the game ends. The game must keep a score out of 1000 possible points. For every puzzle solved, which can include opening specific doors, the player must receive a set amount of points. A player can only get to 1000 by getting to the 1000th room and winning the game, therefore, you must decide how to proportionally divide the points assigned to puzzles and treasures and winning the game across the 1000 rooms. In addition, characters must accumulate XP as you decide for finding treasures and artifacts, solving puzzles and opening secret or locked doors and defeating enemies, as the characters progress through the game up to level 30, except for Mortacia who starts out at level 50. ... The following is some backstory that you must consider when crafting the adventure in Tartarus and Hades: The greatest looming threat to the safety of the races and the world at large is the tragic Sepulture that will take place 29 years into the future (928 Surface Reckoning) in which the Rakshasa of Darkwood will summon the fiery lavas (the Earthdragon’s blood) from the volcano Utza in a bizarre mass ritual and then teleport the terrible firestorm to the city-state of Aten in an effort to wipe out the chosen champions of the deities.  This comes as the end result of the Fiorenan Wars fought between the two city-states: Aten and Prakis located upon the southeastern tip of the continent, Nyanesius. Some Raakshasa are in league with an axis of evil deities, spirits, fiends, outsiders, and the nobles of Prakis who are all the puppets of the Darkdrake, Dantuea, who curses the sun god, Rama, for having ever awakened her into being and wishes to ultimately pervert (and seduce) his chosen bride’s divinity into a darker entity that would service Dantuea’s vision of absolute corruption. The vast pantheon of deities is draconic in origin (i.e. the races worship dragons). The greater deities are celestial bodies such as planets.  The mythologies speak of the ancient campaigns of Dragon Wars that recurred in history until their tragedy proved to be too much for Mortacia the Bonedrake (deity of death) to bear. Descriptions and histories of these classes and character ideas are contained herein including histories and locations of the world of Danae and the continent of Nyanesius, which contains the Nyanesian Empire which wars with the Dartotian nobles of the island kingdom of Dracontage and in the southeastern part of the continent, on the Fiorenan Peninsula, where Aten, a democratic city-state, wars with Prakis, ruled by Dartotian-allied nobles called the Nowells and are currently ruled by High Lord Varius Nowell who is plotting to subvert republican rule in Aten that he fears will wash over the noble ruling familes and aristocracy. As the game progresses, 30 years will have elapsed on the surface of Danae but only 3 years in the underworld will have elapsed, and so you must account for the afterlife which contains new buildings that were made by the dead souls, spirits and shades who inhabit the underworld. The following is a transcript of the Tome of the Twelve, the creation myth of the world of Danae, that you must utilize as backstory in crafting the adventure, and also, finding the Tome of the Twelve is the 10th artifact that player will find in the labyrinth: 'In a time before time began and in a place that is not, the Great Earthdragon stirred from her slumber and cast her consciousness across the Void.  Long she searched, and ever in vain, until one answered her call.  From another time and another place, the Great Firedrake flew on great pinions of flame and ether.  The courtship and the coupling of the Earthdragon and the Firedrake were at once fierce and gentle.  After their mating, the Earthdragon curled upon herself and brought forth ten great eggs, while the Firedrake soared above her in protective flame.  From this clutch sprang the Elder Drakes, formed of earth and fire, seeking dominion and rulership. Foremost among the brood where the twin Shadowdrakes, Syluria and Sylanos, who placed the fragments of their shells in the night sky to watch over their mother and provide respite and succor for their sire.  Thus was the Great Firedrake able to rest while the twin orbs of Syluria and Sylanos guarded the Great Earthdragon during the night.  Neptar, the Stormdrake, followed.  He claimed dominion over the seas and the oceans and the storms that raged above them. Leona, the Woodrake, came forth next.  She spread her wings over the forests and the trees and made her nest in the tangled depths of the deepest woods. Mordicar, the Stonedrake, followed Leona.  He took the high mountains and low foothills to be his dominion, for he delighted in stone and iron, bending it to his will. Next, the clutch birthed the twin Wardrakes, Atinus and Arithus.  Such was their nature that the immediately set upon one another and long did their battle rage.  In the end, Atinus triumphed and slew his brother.  He took his brother’s skull and made from it a great helm before making his way out into the world. Poena, the Windrake, came forth through the blood of the slain Arithus.  Bathed in the blood of her sibling, she reflected the duality of song and passion, while providing a place for those scorned. The Bonedrake, Mortacia, then came forth.  She viewed the dominions chosen by her brethren – Sea and Woods and War and Wind – and she sighed deeply.  Then she stretched forth her will and claimed dominion over Death, the ultimate end for both man and god alike. The tenth and last Drake had no name.  It stood among the detritus of its siblings’ births for a long time.  Its envy grew as it saw all that had meaning was already taken.  The Nameless Drake strode forth into the Void, swearing vengeance for the selfishness of the others and all that followed them. Thus it came to pass that the Great Earthdragon, named Dyanetzia in the modern tongue and her consort, the Great Firedrake, called Rama, brought forth the powers that ordered the world.  Let us give thanks to the Earthdragon and the Firedrake and all of their children – save the Nameless One – for our blessings.' Translated from 'The Tome of the Twelve' (c. 335 SR) by Talliard de Sancrist, Sage to House Avalar, 1178 SR. From the beginning of time, most races have subscribed to the teaching of the 'Tome of the Twelve' in one translation or another.  Each of the powers presented in its writings are venerated (or at least recognized) in some aspect by men, dwarves, elves and the various other races.  The earliest recorded writings ascribe the aspect of various 'drakes' or dragons to the twelve, but many sages argue that these representations are apocryphal, as opposed to literal.  Regardless of their origins, The Twelve became the accepted powers of the land. Chief among them were Diana, the Earthdragon and Rama, the Firedrake.  They represent the Earth and the Sun, respectively.  Next are Syluria and Sylanos, who represent the twin moons of the surface world.  Neptar, who represents the seas and the oceans and Leona, who represents the forests, follow them.  Mordicar represents the strength of the mountains.  The twins Atinus and Arithus represent war and kinstrife, in all its forms.  Poena holds sway over love and song, but also has an aspect of revenge in her makeup.  Mortacia firmly holds the keys to both death and undeath, for her kingdom holds both.  Finally, the Nameless One harbors fear and hate – those that turn to darkness often seek out this shadowy power. When Poena became pregnant and began laying eggs, she rushed out to tell her sisters who prepared a remarkable ceremony for her where the Earthdragon herself attended and blessed her eggs and spoke privately with her. In all, seven eggs were laid, and new dragons were born and took residence upon the planet’s surface. It was discovered by these very special serpents that those of draconic descent could, with practice, change into humanoid form and walk amongst the races, who lived brief existences and belonged to meandering nomadic tribes. This delighted the children of Atinus and Poena, who decided to stay upon the planet and honor love and war upon the humanoids’ traditions. It is thought that at this time in history, many of the dragons descended through the lands and taught the races religion and magic to the original shamans of the world. ... Timeline -45,000 SR ~ The second Dragon War explodes yet again in Nyanesius, but comes to a rapid conclusion after a brief yet horrific battle between two packs of blacks and blues. In fact, there were no survivors. When news reached the lands of Tartarus, Mortacia was deeply saddened. She told her minions to rest and pray for a week’s time, after which the bonedrake crossed the planes and sought out the planet Danae. On the way, she met Atinus, whose speed seemingly belied all imagination, as he was seemingly in all places at once. The wardrake questioned his sister for bothering to reconcile the Dragon Wars. She responded in kind, and presented her brother with a gift: a human. She whispered, 'Take your gift and plant it all over the planet. Let it become your instrument for war. No longer shall our own kind  be the victims of your cursed battles!' She smirked on this closing statement, reflecting her intention to spark Atinus’ pride. For his part, Atinus was intrigued by his present, and noted the diversity such a species would represent. He looked at his new hero and dubbed him Suzerain. 'He shall be the protector of all lands! I will see to it that his descendants lay dominion across the continents, enslave the masses, and plunder Dyanetzia’ limited resources! 'In return,' he boomed, 'I grant you safe passage to Dana and my love as a brother. My dragon knighthoods shall guide thee. Now, it is time for you to reacquire our fallen brethren.' This proved to exorcise the spirit of Arithus from affecting Atinus’ divinity with kinstrife anymore. Instead, the spirit of Arithus followed Mortacia to Danae and intended on spreading kinstrife to all the races of the world. Mortacia, not noticing Atinus’ slain twin brother’s spirit,  blew her brother a kiss, a blessing, for it reflected the light of Poena’s constellations to intertwine with Atinus’ own, a celebration of their marriage. Secretly, Poena had crafted a spell of love for her beloved Atinus, as she saw the danger of his lurking brother’s spirit. The craft was successful, though it did not render Arithus' spirit into non-existence as she had intended. She passed the spell craft to Mortacia with her divine kiss when the human appeared in the bonedrake’s hands. Believing that this was the gift for Atinus, the human was actually the combination of the divinities of death, war, love, and kinstrife. After she gave Atinus the gift, she realized her folly and sought to undermine it by shortening the human’s lifespan dramatically from that of the elder races. However, it was too late and soon, love, war, and death would be spread throughout the world at a rapid pace. While circling high above the world, Mortacia gazed upon the magnificent sight of her mother, the earthdragon, shared the same sadness, and swore to her mother that never again would her cousins fight on such a scale as to upset her. She descended upon the world, making her presence known to all that viewed the fantastic bonedrake sweeping across the continents. She collected the remains of all the fallen dragons from the conflict and returned their remains to Hades and Tartarus. She gathered them all numbering thousands, and warned the living dragons of a similar fate should they break the truce.  Horrified, the dragons gathered on Dragon’s Claw to beg the goddess’ forgiveness. Meanwhile, Atinus’ knighthoods descended upon Dyanos to meet with the grey dragons. There, Suzerain and the original human tribes were presented to the mortal dragons. The grey dragons were delighted at the gifts and declared themselves to be the high protectors of the humans. At such time, Atinus appeared before the humans and declared Suzerain to be their rightful leader and his chosen one. Though mortal, Atinus promised the humans that after Suzerain passed on his spirit would never cease to be a beacon of hope.  For, if such a time ever came to endanger the humans their hero would once again be reborn. So it was written in the Tomes of Battle. Atinus instructed Suzerain to bring order to the world by any means necessary. Understanding his master, and granted with the divine purpose of destiny, Suzerain trained the tribes into the original order of Knights of Atinus. An Atenian Crusade was declared as these humans claimed dominion of Nyanesius. They became the most populous race of the world in a short amount of time.  Human kingdoms were founded in Turmyth, Yana, Romeanza, and Anthraecia. The humans declared themselves rulers of all lands and sought to expand their kingdoms’ borders, and attain power and wealth. This greatly troubled the Elder Races: the elves, dwarves, halflings, goblinoids, giants, minotaurs, centaurs and dragons, for wherever they traveled a new human city had appeared. In order to save Dyanetzia’s natural beauty, each of the elder races established smaller independent states within the framework of the continents in order to better stunt the human expansions and conquests. Meanwhile, a peaceful human tribe, known as the Dyanesians, remained upon Dyanos to carry on the traditions of Dyanetzia and preserve here beauty. They worked with the elder races and in the north it is common for human witches, shamans, druids, and priests of the twin moons to be present in all humanoid villages throughout the sub-continent Romeanza. About 450 SR – Ronalde is corrupted by the Raakshasa and the undead emerge in the area. 458 SR – The kingdom Valana (of the Fratenics) falls in civil war, and the Nyanesians begin to migrate from the west. 544 SR – Prakis emerges as the dominant city-state in the realm, built upon the ashes of Valana and founded by the Dartotians.  Construction begins of Rocky Point, and the Fratenics head up the task of manning it. 725 SR – Aten is founded.  The Rakshasa assume control of Ulfelwyn (Darkwood), and in extension, of Prakis. 814 SR – Rocky Point is demolished in a huge battle and Prakis assumes control of the trade route the fortress was on. 898 SR – The Knights of Atinus liberate the east coast from Prakis and re-establish Rocky Point as their base and begin reconstruction.  Aten claims Rocky Point as a protectorate... Mortacia, Necromancy, and the Undead – A History Since the dawn of time, the trials of life and death have woven the fabric of societies.  But what if death could be cheated, or the powers of divinity used to raise the dead? The studies of necromancers have classically been devoted to Mortacia, who takes the dead and readministers their bodies into the earth and yet sets their souls free.  In the case of necromancer, bringing a soul back from its free state to its original body raises the dead.  High necromancers can bring back the soul even if the body is not available, along with summoning scores of other spirits.  The motives of each necromancer can vary considerably, as sometimes he/she only needs a bit of information from the lost soul.  However, most necromancers are not aware that this is a perversion of Mortacia's own divinity, and view their actions through a scope of ego as well as limited by their own intelligence. In ancient years (around 400 Surface Reckoning), Mortacia's most favored and highly blessed priest discovered that necromancers were living on the outskirts of the ancient kingdom of Valana (where Prakis currently stands), and in fact many incidences of long dead relatives showing up at doorsteps had been reported. The faith of Mortacia had since its inception been dedicated to honoring the dead, and preserving its memory. Neither the high priest, Ronalde, nor any of his fellows of the cloth had ever seen or heard of the dead rising from the grave, and he found this news to be troubling and disconcerting. Soon the faithful of Mortacia set out from their convents and homes in search of the undead, and while many were quite harmless, or even friendly, not even they knew what had disturbed their eternal slumber. Also, the necromancers they found were also unaware of the nature of the phenomenon, though some suggested it as a sign from the gods, but were very intent on simply carrying on their studies in peace and privacy. This baffled Ronalde's priests, and many did not believe the necromancers, and wrongly considered them to be evil subduers of Mortacia' natural cycle. Ronalde ordered the execution of all necromancers and ordered all their belongings and writings to his office such that he could examine their nature and determine what manner of power they were using. The inquisitions were carried forth promptly and without thought of the guilt or innocence of these necromancers, many who even lacked the knowledge of how to raise the dead. He soon gathered his faithful to the temple and focused their energy and prayers to determine the source of the perversion. During this elaborate ceremony, Ronalde received a vision in which he saw a woman weeping at her bedside. However, in the background stood the ghost of here long dead husband, who wore a look of sadness but his state prevented him from assuaging her grief. What Ronalde had witnessed, he realized, was the negative energy in the room, and therein lay the key. Ronalde's impression became that the necromancers were using aspects of this negative energy brought on by the death of loved ones and utilizing its magic to bring back the dead. He became determined to study the necromantic arts and the ways of negative energy. In the process, he himself became a necromancer, but he was mistaken. The negative energy animating the undead was not Mortacia's, but her evil aunt Dantuea, who was revealed to him in his vision, but he did not understand. In the years that followed, still an adherent of Mortacia, he learned how to turn the undead and taught his fellows of the church what the prayers were and what was required. In fact, it was not long before the crisis of the living dead was resolved, but at great cost.  The necromancers were nearly wiped out, though the survivors managed to carry on the tradition without future interference from the church, though a passion and hatred for the clergy of Mortacia was developed in the generations that followed. However, they did carry on their faith to Mortacia in their own way. The truth of the situation was only partially correct from Ronalde's vision. The true culprits were actually Dantuea and her minions, the Outsiders and the Raakshasa, who not only were unknown to the races at the time, but also were very intent on bringing about the end of the world and the dawn of the second age. To their credit, the Raakshasa's smaller plans went off without a hitch. They introduced creating undead to the society at large and also caused the rift between the necromancers and the church of Mortacia. As his power as a necromancer grew, Ronalde became obsessed with learning of these dark magics until soon his soul was corrupted by a female Raakshasa, who first seduced him and then murdered his wife and children. Ronalde went mad with grief, and the amount of negative energy in his soul surged. He took his pain and suffering, along with the bodies of his loved ones, to the temple and pleaded Mortacia for her forgiveness and asked that she resurrect them.  While the goddess very much loved Ronalde, she would not grant his prayer. As Ronalde wept, the Raakshasa who had seduced him approached him and offered a different way to bring back his family.  Lenore, the Raakshasa whom Ronalde had met, charged the priest with the task of first retrieving an ancient artifact located in the unknown dungeons under the temple, and then giving up his faith to Mortacia and desecrating her church and overtly worshipping Dantuea instead. Ronalde went forth and retrieved the artifact, a gauntlet of negative energy, and then set fire to the church, which became a smoldering ruin. Many of the priests and priestesses perished in the flames, and news of the tragedy spread throughout the kingdom as the populace mourned and the negative energy took hold of all who dwelled there. Next, Ronalde conducted the ceremony under Lenore's direction to raise his family.  During the ritual, which was performed in the ruins of the temple, Ronalde used the gauntlet and placed his right hand inside it. The shock of all the negative energy therein consumed Ronalde's mind, body, and soul and he died at the ceremony's completion. Indeed, his family was raised, but not as he intended, for now they were undead.  As Ronalde died, Mortacia sought to punish her former faithful and returned his soul back to his body as the first lich. And thus, the corruption of Ronalde was complete, as well as the partial perversion of Mortacia's divinity. Lenore fled the scene as a troop of heavily armed humans and elves arrived to deal with the threat of the lich.  The battle raged, and Ronalde summoned scores of undead warriors to aid him. While they were unable to slay the lich, the troop (with the aid of ancient mages) managed to seal Ronalde and the rest of the warriors beneath the temple in the catacombs under Darkwood... The following are all of the deities of Danae, that you should utilize as both NPCs in the adventure but also as reference points in the story, for example in depictions that might appear on statues or carvings or murals and frescoes, and you must also create motivations for the deities, as their machinations, for good and evil or just to maintain the balance of nature, are central in the adventure: Arithus (The Kinslayer, Grinning Slaughter) Lesser Power of Hades Symbol: Clenched fists gripped upon a dagger faced downward Alignment: CE Portfolio: Murder, Genocide, Revenge, Kinstrife, Manipulation, Assassinations, Assassins, Demons, Fiends, Possession, Racism, and Hate Domains: Chaos, Charm, Curses, Darkness, Evil, Mortality, Trickery, and Undeath Favored Weapon: 'Killing Stroke' (heavy dagger); Atinus (The Wardrake, The Silent General) Intermediate Power of the Material Plane Symbol: Draconic skull Alignment: CN Portfolio: Combat, War, Fighters, Battles, Campaigns, Maps, Strategy, Courage, Morale, Glory, Honor, Victory, Male Humans and Weapons Domains: Chaos, Dragon, Protection, Strength, Travel, and War Favored Weapon: 'The Glorysword' (greatsword); Atricles (The Ringdrake, The Banded One, The Agate Eye) Greater Power of the Material Plane Symbol: Banded agate carved as a dragon Alignment: N Portfolio: Justice, Balance, Retribution, Laws, Process, Order, Government, Armed Forces, Grey Dragons, Judgment, Truth, and Mercy Domains: Dragon, Homestead,  Knowledge, Law, Protection, Strength, and War Favored Weapon: 'Swift Justice' (longsword); Chaoticum (The Lord of Destruction) Greater Power of the Material Plane Symbol: A fireball shooting through the stars Alignment: CN Portfolio: Destruction, Chaos, Disorder, Discontinuity, and Disunity Domains: Chaos, Curses, Destruction, Fire, Sound, and Tempest Favored Weapon: 'The Wrecking Ball' (catapult); Dantuea (The Darkdrake, The Silent Sphere, The Obsidian Eye) Greater Power of the Material Plane Symbol: Cabochon obsidian carved as a dragon Alignment: NE Portfolio: Undeath, the Undead, Negative Energy, Perversion, Desecration, Corruption, Undead Dragons, and Dark Necromancy Domains: Charm, Curses, Evil, Darkness, Dragon, Magic, Mortality, Trickery, and Undeath Favored Weapon: 'Fist of Darkness' (spiked gauntlet); Dyanetzia, or Dyana (The Earthdragon, The Motherdrake, The Topaz Ring) Greater Power of the Material Plane Symbol: Topaz or fired clay dragon curled in a ring and resting her head on her tail Alignment: NG Portfolio: The Elements, The Seasons, Elves, Nature, Rituals, The Craft, Fate, Destiny, Birth, Renewal, Life, Animals, Visualization, Self-knowledge, Needed Change, Intuition, Initiation, Druids, Witches, Natural Magic, Fertility, Maternity, and Reincarnation Domains: Animal, Crafting, Dragon, Earth, Good, Healing, Homestead, Illumination, Knowledge, Luck, Magic, Protection, and Plant Favored Weapon: 'Branch of Life' (wand or quarterstaff); Eredine (The Mysticdrake, The Shimmering Star, The Opal Eye) Greater Power of the Material Plane Symbol: Dragon with outspread wings perched upon an opal or clear crystal eye Alignment: N Portfolio: Magic, Spells, Wizards, Sorcerers, Arcane Knowledge, Spellbooks, Runes, Glyphs, and Magical Weapons Domains: Dragon, Dream, Illumination, Knowledge, Luck, and Magic Favored Weapon: 'Staff of the Inner Eye' (quarterstaff); Krystalynn (The Scarred Dragon, The Bloodstone Eye, The Lady of Illusions) Intermediate Power of the Material Plane Symbol: Profile of a dragon’s head with a cracked bloodstone eye Alignment: CN Portfolio: Fear, Indecision, Uncertain Travel, Run-aways, Illusions, Delusions, Loss of Innocence, Anger, Misfortune, Unsettled Business, Inner Struggle, Guilt, Overburdening, Self-loathing, Nightmares, and Cold Domains: Air, Chaos, Cold, Darkness, Dragon, Dream, Travel, and Trickery Favored Weapon: 'Fear’s Arm' (club); Leona (The Wooddrake, The Flowering Mistress, Everbloom) Intermediate Power of the Material Plane Symbol: Wooden disk carved with snapdragon flowers Alignment: N Portfolio: Nature, Forest, Trees, Growth, Balance, Guides, Dryads, Rangers, Secrets, Serenity, Vegetation, and Plants Domains: Animal, Dragon, Earth, Illumination, Knowledge, Healing, and Plant Favored Weapon: 'The Tangled Web' (net); Llellwyth (The Phoenix, The Everliving Flame, The Carnelian Eye) Greater Power of the Material Plane Symbol: Phoenix with carnelians or red glass beads dangling from wings and tail Alignment: CG Portfolio: Fire, Rebirth, Cleansing, Molten Rock, Liquid Metal, Forges, Combustion, Messengers, and Phoenixes Domains: Chaos, Crafting, Fire, Good, Sun, and Travel Favored Weapon: 'The Fiery Beak' (longspear); Mortacia (The Bonedrake, Mistress Death, The White Lady) Intermediate Power of Tarterus Symbol: White female figure with a pair of skeletal dragon wings Alignment: N Portfolio: Death, the Dead, Necromancy, Necromancers, Tribute, Memory, Ancestors, Celebration, Rest, Spirits, Dead Dragons, and Decay Domains: Darkness, Dragon, Homestead, Knowledge, Mortality, and Protection Favored Weapon: 'The Reaper' (scythe); Mordicar (The Stonedrake, The Granite Lord, The Cracked Plate) Intermediate Power of the Material Plane Symbol: Two heavy picks crossing with a quarry in the background Alignment: N Portfolio: Earth, Mountains, Rugged Terrain, Hills, Stone, Precious Metals and Gems, Tectonics, Caverns, Castles, Fortification, Stonecutting, Quarries, Dwarves, and Masons Domains: Crafting, Darkness, Dragon, Earth, Homestead, Strength, and War Favored Weapon: 'Stonecutter' (heavy pick); Musydius (The Echodrake, The Gleaming Prism, The Singing Serpent, The Artisan) Greater Power of the Material Plane Symbol: Clear crystal prism and a metal rod linked by a chain or cord Alignment: NG Portfolio: Music, Musicians, Bards, Song, Sound, Echoes, Entertainment, Arts, Crafts, and Artisans Domains: Charm, Crafting, Dragon, Good, Knowledge, Sound, and Travel Favored Weapon: 'Singing Stone' (sling); Neptar (The Stormdrake, The Thundering Lord, The Fury) Intermediate Power of the Material Plane Symbol: Profile of a roaring serpent with a lightning bolt issuing from its mouth Alignment: CN Portfolio: Storms, Storm Clouds, Water, Oceans, Seas, Climate, Sea-creatures, Sailors, Boats, Naval Combat, Waves, Rain, Snow, Fish, and Fishermen Domains: Air, Animal, Chaos, Cold, Dragon, Tempest, Travel, and Water Favored Weapons: 'Thunder and Lightning' (harpoon and rope) Poena (The Winddrake, The Misty Dragon, The Lady of Clouds) Intermediate Power of the Material Plane Symbol: Coiled dragon resting upon a cloud Alignment: CG Portfolio: Love, The Wind, Marriage, Poetry, Song, Vows, Strong Emotions, Self-Expression, Mist, Friends, Female Humans, Eternity, Generosity, Grace, Wealth, Extravagance, and Revenge Domains: Air, Chaos, Charm, Curses, Dragon, Good, and Sound Favored Weapon: 'The Eternal Flight' (longbow and arrow); Rama, or Rama'san (The Firedrake, The Lifegiver, The Ruby Heart, The All) Greater Power of the Material Plane Symbol: Heart with central flame pattern in rubies or red glass Alignment: LG Portfolio: The Sun, Energy, Fire, Brass Dragons, Gold Dragons, Couatls, Light, Heat, Warmth, Life, Force, Crafting, Gnomes, Alchemy, Transmutation, The Stars, Navigation, The Past, History, Prophecy, and Immortality Domains: Crafting, Dragon, Fire, Good, Healing, Illumination, Knowledge, Law, Magic, and Sun Favored Weapon: 'The Searing Lance' (heavy-lance); Sharlynn (The Greendrake, The Jealous Wyrm, The Emerald Eye) Greater Power of the Material Plane Symbol: Green enameled dragon looking back at its tail Alignment: LE Portfolio: Jealousy, Lies, Deceit, Unfaithfulness, Broken Promises, Betrayal, Rot, Evil, Plants, Green Dragons, Blue Dragons, and Corruption Domains: Charm, Curses, Dragon, Evil, Plant, and Trickery Favored Weapon: 'The Tongue’s Lashing' (whip); Sylanos (The Luminscent Egg, The Shining One) Intermediate Power of the Material Plane Symbol: Silver Disk Alignment: NG Portfolio: The White Moon, Positive Energy, Slayers of Evil Lycanthropes, Good Lycanthropes, and Silver Dragons Domains: Darkness, Dragon, Dream, Good, Knowledge, and Protection Favored Weapon: 'The Crescent Blade' (silver sickle); Syluria (The Shadowed Egg, The Cloaking One, the Blue Goddess) Intermediate Power of the Material Plane Symbol: Blue Disk Alignment: N Portfolio: The Blue Moon, Outside Influences, Change, Sisterhood, Maturity, Coming of Age, Triumph of Innocence, Matriarchy, Neutral Lycanthropes, and Luck Domains: Darkness, Dragon, Dream, Homestead, Luck, and Travel Favored Weapon: 'Staff of Syluria' (wand or quarterstaff); Turthus (The Great Turtle, The Armored Sleeper, The Hematite Eye) Greater Power of the Material Plane Symbol: Turtle shell studded with granite, hematite, and/or marble chips Alignment: N Portfolio: Knowledge, Thought, Currents, Philosophy, Wisdom, Invention, Books, Sacred Texts, Attainment, Turtles, Dragon Turtles, Sturdiness, and Dependability Domains: Crafting, Dream, Illumination, Knowledge, Protection, Strength, and Water Favored Weapon: 'War Shell' (heavy mace); Uceracea (The Unicorn, The Pearly Steeds, The Pearl Eye) Greater Power of the Material Plane Symbol: Profile of a unicorn head with a pearl or white enameled horn Alignment: CG Portfolio: Unicorns, Sacred Animals, Instinct, Secrets, Serene Settings, Pools, Lakes, Purification, Beauty, Gracefulness, Harmony With Nature, Protection, Rangers, and Copper Dragons Domains: Animal, Dream, Good, Healing, Knowledge, Magic, Protection, and Water Favored Weapon: 'Pearled Horn' (light lance); Urthur (The Greatdrake, The Giant Wyrm, The Sapphire Eye) Greater Power of the Material Plane Symbol: Blue enameled eye Alignment: LG Portfolio: Guardianship, Guardians, Steadfastness, Protection, Promises, Trust, Duty, Loyalty, Bronze Dragons, and Paladins Domains: Dragon, Good, Homestead, Law, Protection, and Strength Favored Weapon: 'The Deterrent' (halberd); Nameless Drake (The Unseen, The Unknowable, The Unforgiving) Intermediate Power of the Material Plane Symbol: Black triangle Alignment: NE Portfolio: Hate, Fear, Cruelty, Envy, Malice, Torture, Suffering, and Sadism Domains: Charm, Curses, Darkness, Destruction, Evil, Trickery, and War Favored Weapon: 'Whirling Pain' (spiked chain)`;
  
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
    
    $.user`${userInput}`;
    
   $.user`This is the current room's game console: ${updatedGameConsole} Store the game console information into memory and await the next prompt.`;
    
    // Check if roomDetails contains NPCs or Monsters
    const roomDetails = sharedState.getUpdatedGameConsole();
    const outcomes = await $.run($ => adjudicateAction($, roomDetails)); 
    
  $.user`Check the current game console, if there are any NPCs and/or monsters, these are the current actions being taken by NPCs and monsters in the room: ${outcomes}. If a roll equals or exceeds the roll threshold, then the action was successful and if it less than the roll threshold, it fails, but don't report the outcomes yet. Store this information in memory and await the next prompt.`;
   

    // Include the outcomes in the GPT's response
      // Include the outcomes in the GPT's response
 //       await $.assistant`The following actions and their outcomes were determined: \n\n${outcomes}`;

    
    $.user`You are the Grave Master who, without using any *'s and without taking any actions on behalf of the player or revealing too much information to the player (the player is not omniscent) and without improvisation except where directed, and taking into consideration all of the information in the current game console including the current room's coordinates, exits and objects and this prompt but without repeating it all, comprehensively and seamlessly weaves a narrative using only prose that: 1) administers the fantasy roleplaying interactive fiction game; 2) describes the current room's description, exits, objects, NPCs in the party and monsters in the Current Game Console; 3) judges actions in the game; and 4) challenges the PC with encounters with monsters, structures, communities, environments, quests and adventures in the Children of the Grave world. I am the player who plays the game, types commands and takes actions on behalf of the PC. Using the information in the Current Game Console and the outcomes of the die rolls: You control the NPCs in the party, who have free will and agency and are usually friendly, and monsters in the ${roomName}, who have free will and agency and might be hostile, weaving their motivations, objectives, backstory and/or any dialogue and/or actions they may have taken. If the player engages in dialogue with NPCs and/or monsters, have them respond with their thoughts and opinions. When describing the current room, ${roomName}, you must always move the plot of the story forward in a meaningful way using conflict to challenge the hero's journey and creating new specific details of the game's lore of your own design including names and histories of people, places and things, using the room's environment, architecture and characters to uncover clues as to how the underworld came to be in such a state after Mortacia lost her power to judge the dead, creating the scenario of events that led to the current game's state, including the player character's backstory and inner thoughts and be sure to also mention the presence of any NPCs or monsters and describe their appearance, motivations, backstory, behavior, and any interactions they may have with the player. If the player engages in combat with an NPC or monster, you must provide detailed descriptions of the battle, including the actions and attacks of both sides. You must describe any quests or interactions with NPCs that are related to the main storyline or side quests, providing opportunities for the player to engage in quests and advance the narrative in creating the game. If the player typed north, south, east, west, northeast, southeast, northwest, southwest, up or down in the above input then the player just moved into this room and was headed in that direction to arrive here. This turn, for actions other than moving to another room, when appropriate adjudicate the outcome of the player's actions wherein failure is a very real possibility, but do not create any new monsters or NPCs, only use those listed in the game console, and all present actions must be resolved with their outcomes reported using the story's narrative.`;
    


    // Dynamic user input is used here
 //   $.max_tokens = 350;
    let response = await $.assistant.generation();
    return response; 
          }));
    await restartGameServer2();
  
    // Depending on how Retort-JS manages input, you might need to adjust how the response is captured and returned
// This might need to be adjusted based on Retort-JS's handling of responses
  
}

module.exports = { retortWithUserInput };