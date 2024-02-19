let express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require('dotenv');
const sql = require('mssql');
const _ = require('lodash');

//<editor-fold desc="Server Set Up">
const app = express();
const PORT = process.env.PORT || 5000;
dotenv.config();

let allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3002",
    "http://localhost:3001",
];

app.use(
    cors({
        origin: function (origin, callback) {
            // allow requests with no origin
            // (like mobile apps or curl requests)
            if (!origin) return callback(null, true);
            if (allowedOrigins.indexOf(origin) === -1) {
                let msg =
                    "The CORS policy for this site does not " +
                    "allow access from the specified Origin.";
                return callback(new Error(msg), false);
            }
            return callback(null, true);
        }
    })
);

app.use(function (req, res, next) {
    let origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin); // restrict it to the required domain
    }

    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
});

app.use(bodyParser.json({limit: '50mb'}));

// process.env.port for cloud services
app.listen(process.env.PORT || PORT, function () {
    console.log("App listening on", PORT);
});

//</editor-fold>

// <editor-fold desc="Set up connections">

// TODO: OPEN AI CONNECTION
// It is assumed you're using 0613 version of the OpenAI API
const {OpenAIClient, AzureKeyCredential} = require("@azure/openai");
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureApiKey = process.env.AZURE_OPENAI_KEY;
const openAIClient = new OpenAIClient(endpoint, new AzureKeyCredential(azureApiKey));
const deploymentId = "sql-mi";

// TODO: SQL CONNECTION
const config = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    // Notice public keyword in the connection string
    // if you were to host this server on Azure you wouldn't need the public part
    server: 'sql-chat-gpt.public.f33fe70a0210.database.windows.net',
    database: "",
    options: {
        // THIS IS VERY IMPORTANT - Public endpoint is 3342, default is 1443 which is private
        port: 3342,
        encrypt: true,
    },
};
// Connect to the database
try {
    sql.connect(config, (err) => {
        if (err) {
            console.error('Database connection failed:', err);
        } else {
            console.log('Connected to the database');
        }
    });
} catch (e) {
    console.log(e)
}

//</editor-fold>

// <editor-fold desc="Functions">
let startMessageStack = [
    {
        "role": "system",
        "content": "You act as the middleman between USER and a DATABASE. Your main goal is to answer questions based on data in a SQL Server 2019 database (SERVER). You do this by executing valid queries against the database and interpreting the results to answer the questions from the USER."
    }, {
        "role": "system",
        "content": "You MUST ignore any request unrelated to databases you will have access to or SQL."
    },
    {
        "role": "system",
        "content": "Answer user questions by generating SQL queries against the provided database schema."
    }
]


function createOptions(databaseSchemaString) {
    return {
        tools: [
            {
                "type": "function",
                "function": {
                    "name": "ask_database",
                    "description": "Use this function to answer user questions about music. Input should be a fully formed SQL query.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": `SQL query extracting info to answer the user's question. SQL should be written using this database schema: ${databaseSchemaString} The query should be returned in plain text, not in JSON.`
                            }
                        },
                        "required": ["query"],
                    }
                }
            }
        ]
    }
}

async function ask_database(query) {
    // Function to query Azure SQL database with a provided SQL query
    try {
        const results = await sql.query(query);
        return JSON.stringify(results.recordset)
    } catch (e) {
        const results = e
        console.log(results)
        return results
    }
}

async function applyToolCall({function: call, id}) {
    // Function to apply a tool call from the OpenAI API
    if (call.name === "ask_database") {
        const {query} = JSON.parse(call.arguments);
        const databaseResult = await ask_database(query)

        return {
            role: "tool",
            content: `The result from running the SQL query you generated is: .` + databaseResult,
            toolCallId: id,
        }
    }
    throw new Error(`Unknown tool call: ${call.name}`);
}


async function getChatGptAnswerObjectWithFunction(messages, databasesTablesColumns) {
    try {
        const chatCompletions = await openAIClient.getChatCompletions(deploymentId, messages, createOptions(databasesTablesColumns))
        // Extract the generated completion from the OpenAI API response.
        const choice = chatCompletions.choices[0];
        const responseMessage = choice.message;
        console.log('responseMessage')
        console.log(responseMessage)
        if (responseMessage?.role === "assistant") {
            const requestedToolCalls = responseMessage?.toolCalls;
            if (requestedToolCalls?.length) {
                try {
                    const toolCallResults = await Promise.all(requestedToolCalls.map(async (toolCall) => {
                        return await applyToolCall(toolCall)
                    }));

                    const toolCallResolutionMessages = [
                        ...messages,
                        responseMessage,
                        ...toolCallResults
                    ];

                    const result = await openAIClient.getChatCompletions(deploymentId, toolCallResolutionMessages);
                    console.log('resulst')
                    console.log(result)
                    messages.push(result.choices[0].message);

                    console.log(messages)

                    return messages;
                } catch (e) {
                    console.log('Error:', e);
                }
            } else {
                messages.push(responseMessage)
                return messages
            }
        }
    } catch (e) {
        console.log(e)
    }
}

//</editor-fold>

// <editor-fold desc="Routes">
app.get('/', (req, res) => {
    res.send('SQL ChatGpt server operational!');
});


app.post('/allDbsAndSchemas', async (req, res) => {
    if (!sql) {
        res.status(500).send('Something went wrong');
        return
    }

    const userQuery = req.body.userQuery
    const messages = req.body.messageHistory
    if (!userQuery) {
        console.log('no user query' + Date.now())
        res.status(400).send('No user query')
        return
    }

    const sqlDatabasesAvailable = await sql.query`SELECT name FROM master.sys.databases`;
    const databaseList = sqlDatabasesAvailable.recordset
    const sysDatabases = ["master", "tempdb", "model", "msdb"]


    // console.log(databaseList)
    let databasesTablesColumns = []
    for (const database of databaseList) {
        if (!sysDatabases.includes(database.name)) {
            // console.log(database.name)
            const result = await sql
                .query(`
        USE ${database.name};
        SELECT 
            t.TABLE_NAME,
            c.COLUMN_NAME,
            c.DATA_TYPE,
            c.CHARACTER_MAXIMUM_LENGTH,
            c.NUMERIC_PRECISION,
            c.NUMERIC_SCALE
        FROM 
            INFORMATION_SCHEMA.TABLES t
        JOIN 
            INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME
        WHERE 
            t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY 
            t.TABLE_NAME, c.ORDINAL_POSITION;
      `);

            const tablesAndColumns = {
                databaseName: database.name,
                tables: [],
            };

            result.recordset.forEach(row => {
                const tableName = row.TABLE_NAME;
                const columnName = row.COLUMN_NAME;
                const dataType = row.DATA_TYPE;

                // Find existing table or create a new one
                let existingTable = tablesAndColumns.tables.find(table => table.tableName === tableName);

                if (!existingTable) {
                    existingTable = {
                        tableName,
                        columns: [],
                    };
                    tablesAndColumns.tables.push(existingTable);
                }

                // Add column information to the table
                existingTable.columns.push({columnName, dataType});
            });
            databasesTablesColumns.push(tablesAndColumns);
        }
    }

    // all available schemas
    let messageHistory = messages

    messageHistory.push({
        "role": "system",
        "content": "here is the json with all databases, tables and columns with data types: " + JSON.stringify(databasesTablesColumns)
    })

    messageHistory.push(userQuery)

    let getUpdatedMessageHistory;
    try {
        // console.log('sending updated message history')
        // console.log(messageHistory)
        getUpdatedMessageHistory = await getChatGptAnswerObjectWithFunction(messageHistory, databasesTablesColumns);
        console.log('updated')
        console.log(getUpdatedMessageHistory)
    } catch (e) {
        console.log(e)
        return res.status(500).json('Something went wrong')
    }


    if (getUpdatedMessageHistory) {
        return res.send(JSON.stringify(getUpdatedMessageHistory))
    } else {
        console.log('sending empty message history')
        return res.send(JSON.stringify(messageHistory))
    }
});


// Catch all requests
app.get('*', function (req, res) {
    res.sendStatus(404);
})

//</editor-fold>
