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

    const { prompt, history } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    console.log('--------------------');
    console.log('New Message:');
    console.log('Session ID:', req.sessionID);
    console.log('User Input:', prompt);

    try {
        // Step 1: Create a thread
        const createThreadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v1'
            },
            body: JSON.stringify({})
        });

        if (!createThreadResponse.ok) {
            const errorData = await createThreadResponse.json();
            console.error('Thread creation error:', errorData);
            return res.status(createThreadResponse.status).json({ error: 'Failed to create thread', details: errorData });
        }

        const thread = await createThreadResponse.json();
        console.log('Thread created:', thread.id);

        // Step 2: Add messages to the thread
        for (const message of history) {
            await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'OpenAI-Beta': 'assistants=v1'
                },
                body: JSON.stringify({
                    role: message.role,
                    content: message.content
                })
            });
        }

        // Add the new user message
        await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v1'
            },
            body: JSON.stringify({
                role: "user",
                content: prompt
            })
        });

        console.log('Messages added to thread');

        // Step 3: Run the assistant
        const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v1'
            },
            body: JSON.stringify({
                assistant_id: assistantId,
                model: "gpt-4-turbo-preview"
            })
        });

        if (!runResponse.ok) {
            const errorData = await runResponse.json();
            console.error('Run creation error:', errorData);
            return res.status(runResponse.status).json({ error: 'Failed to run assistant', details: errorData });
        }

        const run = await runResponse.json();
        console.log('Run created:', run.id);

        // Step 4: Polling for completion
        let runStatus = await checkRunStatus(thread.id, run.id, apiKey);
        while (runStatus.status !== 'completed') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runStatus = await checkRunStatus(thread.id, run.id, apiKey);
        }

        console.log('Run completed');

        // Step 5: Retrieve the messages
        const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'OpenAI-Beta': 'assistants=v1'
            }
        });

        if (!messagesResponse.ok) {
            const errorData = await messagesResponse.json();
            console.error('Messages retrieval error:', errorData);
            return res.status(messagesResponse.status).json({ error: 'Failed to retrieve messages', details: errorData });
        }

        const messages = await messagesResponse.json();
        const aiResponse = messages.data[0].content[0].text.value;
        
        console.log('AI Response:');
        console.log(aiResponse);
        console.log('--------------------');

        res.json({ response: aiResponse });

    } catch (error) {
        console.error('Error:', error.stack || error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.post('/clear-context', (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // Clear any server-side context if needed
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

// Helper function to check the run status
async function checkRunStatus(threadId, runId, apiKey) {
    const response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'OpenAI-Beta': 'assistants=v1'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to check run status: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('Session Secret:', process.env.SESSION_SECRET ? 'Set' : 'Not Set');
    console.log('Secret Password:', process.env.SECRET_PASSWORD ? 'Set' : 'Not Set');
});
