const express = require('express');
const session = require('express-session');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Trust first proxy for secure cookies in production
app.set('trust proxy', 1);

// Session middleware with more permissive settings
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Middleware to log session info and clear context for new sessions
app.use((req, res, next) => {
    console.log('--------------------');
    console.log('New Request:');
    console.log('Session ID:', req.sessionID);
    console.log('Is Authenticated:', req.session.authenticated);

    if (!req.session.initialized) {
        console.log('New session detected. Clearing context.');
        req.session.messageHistory = [];
        req.session.initialized = true;
    }

    console.log('--------------------');
    next();
});

const MAX_HISTORY = 5;

app.post('/login', (req, res) => {
    const enteredPassword = req.body.password;
    const secretPassword = process.env.SECRET_PASSWORD;

    console.log('--------------------');
    console.log('Login Attempt:');
    console.log('Session ID:', req.sessionID);

    if (enteredPassword === secretPassword) {
        req.session.authenticated = true;
        req.session.messageHistory = []; // Clear context on successful login
        console.log('Login successful. Context cleared.');
        res.status(200).json({ success: true });
    } else {
        console.log('Login failed');
        res.status(401).json({ success: false, message: 'Incorrect password' });
    }
    console.log('--------------------');
});

app.post('/generate-response', async (req, res) => {
    if (!req.session.authenticated) {
        console.log('Unauthorized access attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { prompt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const model = 'gpt-4'; // Use the correct model name here

    console.log('--------------------');
    console.log('New Message:');
    console.log('Session ID:', req.sessionID);
    console.log('User Input:', prompt);

    // Add the new message to history
    req.session.messageHistory.push(prompt);
    if (req.session.messageHistory.length > MAX_HISTORY) {
        req.session.messageHistory.shift(); // Remove the oldest message if we exceed MAX_HISTORY
    }

    console.log('Updated Message History:');
    req.session.messageHistory.forEach((msg, index) => {
        console.log(`[${index + 1}] ${msg}`);
    });

    // Create a context-rich prompt
    const contextPrompt = req.session.messageHistory.join('\n');

    console.log('Full Context Prompt:');
    console.log(contextPrompt);

    try {
        // Step 1: Use /v2/completions endpoint to generate response
        const aiResponse = await fetch('https://api.openai.com/v2/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                prompt: contextPrompt,
                max_tokens: 150, // Adjust tokens as per your need
                temperature: 0.7 // Adjust temperature as needed
            })
        });

        if (!aiResponse.ok) {
            const errorData = await aiResponse.json();
            console.error('AI response error:', errorData);
            return res.status(aiResponse.status).json({ error: 'Failed to generate response', details: errorData });
        }

        const data = await aiResponse.json();
        const responseText = data.choices[0].text.trim();
        
        console.log('AI Response:');
        console.log(responseText);
        console.log('--------------------');

        res.json({ response: responseText });

    } catch (error) {
        console.error('Error:', error.stack || error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.post('/clear-context', (req, res) => {
    if (!req.session.authenticated) {
        console.log('Unauthorized clear context attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('--------------------');
    console.log('Clearing Context:');
    console.log('Session ID:', req.sessionID);
    
    req.session.messageHistory = []; // Clear the message history for this session
    console.log('Message history cleared');
    console.log('--------------------');
    
    res.json({ success: true });
});

app.post('/keep-alive', (req, res) => {
    console.log('--------------------');
    console.log('Keep-Alive Request:');
    console.log('Session ID:', req.sessionID);
    
    if (req.session.authenticated) {
        console.log('Keep-alive successful');
        res.sendStatus(200);
    } else {
        console.log('Keep-alive failed - not authenticated');
        res.sendStatus(401);
    }
    console.log('--------------------');
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('Session Secret:', process.env.SESSION_SECRET ? 'Set' : 'Not Set');
    console.log('Secret Password:', process.env.SECRET_PASSWORD ? 'Set' : 'Not Set');
});
