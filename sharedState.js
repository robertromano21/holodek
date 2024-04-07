// sharedState.js
let personalNarrative = "";
let updatedGameConsole = "";

module.exports = {
    getPersonalNarrative: () => personalNarrative,
    setPersonalNarrative: (narrative) => { personalNarrative = narrative; },
    getUpdatedGameConsole: () => updatedGameConsole,
    setUpdatedGameConsole: (consoleData) => { updatedGameConsole = consoleData; }
};
