const { exec } = require('child_process');

const { json } = require('stream/consumers');

const retort = require('./gameRetort').retort;

const run = require('./gameRetort').run;
const GraveMasterProtocol = require('./graveMasterProtocol');
const StoryPrompts = require('./graveMasterStoryPrompts');
const RoomDescription = require('./roomDescription');
const GeneratedNames = require('./generatedNames');

const { OpenAI } = require('openai');

const fs = require('fs');

const path = require('path');


const ROOT       = path.join(__dirname, '..');
const RETORT_DIR = path.join(ROOT, 'retort');
const SID_DIR    = path.join(ROOT, 'sid');
const RENDER_JS  = path.join(ROOT, 'assets', 'renderSid_poke.js');
const { generateCharacterSprite, createCharacterSpriteSpec } = require('../assets/renderCharacterSprite.js');
const CommandIntent = require('../assets/commandIntent');
const ActionFeedback = require('../assets/actionFeedback');
const PhysicalPuzzles = require('../assets/physicalPuzzles');
const {
  buildSceneSpec,
  sceneInputFromConsole,
  applySceneSpecToClassification,
  applySceneSpecToVisualStyle,
  sceneRequiredCustomTypes,
  checkSceneAgainstDungeon,
  describeSceneSpec
} = require('./sceneSpec.js');

// Save the room's scene spec in the room-name database under its coordinates so
// prose checks and later visits read the same structured scene.
const { applySceneGraphics, applySurfaceArt, placeSceneLandmarks, placeSceneObjects } = require('./sceneRoomBuilder.js');
const { applySceneArchitecture } = require('./sceneArchitecture.js');
const { applySceneRoofs } = require('./sceneRoofs.js');
const { prepareSceneGeography, applySceneGeography } = require('./sceneGeography.js');
const { prepareSceneVegetation, applySceneVegetation } = require('./sceneVegetation.js');
const { prepareSceneBiomeProps, applySceneBiomeProps } = require('./sceneBiomeProps.js');
const BlueprintPillars = require('./blueprintPillars.js');
const DungeonGeneration = require('./dungeonGeneration.js');
const IndoorBlueprint = require('./indoorBlueprint.js');

// holodek-1 only: pack relevant campaign memory into the 131k window
const activeModel = $.model || (sharedState.getGameModel && sharedState.getGameModel()) || "";
const isHolodek1 = /holodek-1/i.test(activeModel);
let retrievedContext = "";
if (isHolodek1) {
  try {
    const recall = CampaignMemory.search(userInput || "", {
      limit: 40,
      maxChars: 400000
    });
    if (recall && recall.length) {
      retrievedContext = "\n\n=== RELEVANT CAMPAIGN MEMORY (holodek-1 retrieval) ===\n" +
        recall.map(r => (r.excerpt || r.text || "").trim()).filter(Boolean).join("\n---\n") +
        "\n=== END MEMORY ===\n";
    }
  } catch (err) {
    console.warn("holodek-1 memory retrieval skipped:", err.message);
  }
}

await $.user`${retrievedContext}FINAL STORY RESPONSE: Follow the full Integrate and interactive-fiction action/dialogue instructions above. Write the player-facing narrative FIRST, then append the CHARACTER_DIALOGUE metadata. Cache planning is secondary and must not replace the story. ${initialArrival ? 'This is the full opening scene: develop the established TURN 0 premise and the call to adventure without deciding actions for the PC.' : enteringRoom ? 'This is a full room-entry story continuation, not another static room or puzzle description.' : 'Resolve the latest player input and continue the scene; a genuine automatic idle tick keeps its requested short format.'} If no characters are permitted to speak, still narrate an appropriate environmental or story development without inventing dialogue, discoveries or completed actions. Preserve player agency, current mechanics, exact names and the nearby-speaker limits. Return actual prose before metadata, not a metadata-only answer.`;
