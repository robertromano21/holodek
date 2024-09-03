const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { retortWithUserInput } = require('./retort/retortWithUserInput.js');
const sharedState = require('./sharedState');
const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

// Serve all static files from the assets directory
app.use('/', express.static(path.join(__dirname, 'assets')));

app.post('/processInput', async (req, res) => {
    const { userInput } = req.body;
    const response = await retortWithUserInput(userInput);
    const updatedGameConsole = sharedState.getUpdatedGameConsole();
    console.log("Sending updatedGameConsole to client:", updatedGameConsole);
    res.json({ response: response.content, updatedGameConsole, imageUrl: response.imageUrl });
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