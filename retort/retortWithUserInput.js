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