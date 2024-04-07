const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { retortWithUserInput } = require('./retort/retortWithUserInput.js'); // Adjusted to import the new function
const sharedState = require('./sharedState');
const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

app.post('/processInput', async (req, res) => {
    const { userInput } = req.body;
    const response = await retortWithUserInput(userInput);
    res.json({ response });
});

app.post('/updateState', async (req, res) => {
    const { personalNarrative, updatedGameConsole } = req.body;

    if (personalNarrative !== undefined) {
        sharedState.setPersonalNarrative(personalNarrative);
    }

    if (updatedGameConsole !== undefined) {
        sharedState.setUpdatedGameConsole(updatedGameConsole);
    }

    res.json({ message: 'State updated successfully' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
