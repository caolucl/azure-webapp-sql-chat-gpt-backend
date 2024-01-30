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

JSON.safeStringify = (obj, indent = 2) => {
    let cache = [];
    const retVal = JSON.stringify(
        obj,
        (key, value) =>
            typeof value === "object" && value !== null
                ? cache.includes(value)
                    ? undefined // Duplicate reference found, discard key
                    : cache.push(value) && value // Store value in our collection
                : value,
        indent
    );
    cache = null;
    return retVal;
};

function extractValidJson(inputString) {
    const regex = /{.*}/; // Matches anything between curly braces
    const match = inputString.match(regex);
    console.log('inputString')
    console.log(inputString)
    console.log(match)
    if (match && match.length > 0) {
        try {
            const validJson = JSON.parse(match[0]);
            return JSON.stringify(validJson);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return null; // Invalid JSON
        }
    }
}

async function getChatGptAnswerObject(messages) {
    let messageHistory = messages;
    console.log('running the method');
    // console.log(messages);

    while (true) {
        try {
            const result = await openAIClient.getChatCompletions(deploymentId, messages);
            // console.log(result.choices[0].message.content)
            const validJson = extractValidJson(result.choices[0].message.content);
            // console.log(validJson)
            if (!validJson) throw new Error('Invalid JSON');
            // console.log(validJson)
            result.choices[0].message.content = validJson
            // console.log(result.choices[0].message);
            let chatGptAnswerObject = JSON.parse(result.choices[0].message.content);
            messageHistory.push(result.choices[0].message);

            switch (chatGptAnswerObject.recipient) {
                case 'SERVER':
                    // console.log('server case');
                    if (chatGptAnswerObject.action === 'QUERY') {
                        const sqlResult = await sql.query(chatGptAnswerObject.message);

                        messageHistory.push({
                            role: 'system',
                            content: 'The response you got from the database is:' + JSON.stringify(sqlResult.recordset),
                        });

                        // Continue the loop
                    }
                    break;
                case 'USER':
                    console.log('user case');
                    console.log('returning message history');
                    return messageHistory;
                case 'ASSISTANT':
                    console.log('ODD ASS BEHAVIOR');
                    // messageHistory.push(chatGptAnswerObject);
                    return JSON.stringify(messageHistory);
                default:
                    console.log('Something went wrong');
                    throw new Error('Case not supported');
            }
        } catch (e) {
            console.log('catching');
            console.log(e);
            console.log(e.code);

            // account for errors that aren't poorly formatted json
            if (e.code) break
            if (e.toString().includes("TypeError: Cannot read properties of null")) break

            console.log('retrying')
            messageHistory.push({
                role: 'system',
                content:
                    'Repeat that answer but format like the following JSON' +
                    ' {"recipient": "SERVER", "action": "QUERY", "message":"SELECT COUNT(*) FROM test.dbo.Venues;" and no other text or explanation. This is not an acceptable answer: \'Here is your answer in valid JSON: {"recipient":"SERVER", "action":"QUERY", "message":"SELECT COUNT(*) FROM test.dbo.Venues;"}\'}',
            });
        }
    }
}


// async function getChatGptAnswerObject(messages) {
//   let messageHistory = messages;
//   console.log('running the method')
//   try {
//     const result = await openAIClient.getChatCompletions(deploymentId, messages);
//     result.choices[0].message.content = extractValidJson(result.choices[0].message.content)
//     console.log(result.choices[0].message)
//     let chatGptAnswerObject = JSON.parse(result.choices[0].message.content)
//     messageHistory.push(result.choices[0].message)
//     console.log('resultssssssssssssssssssssssssssssssssssss')
//     console.log(result)
//     console.log('chatGptAnswerObject')
//     console.log(chatGptAnswerObject)
//     switch (chatGptAnswerObject.recipient) {
//       case 'SERVER':
//         console.log('server case')
//         if (chatGptAnswerObject.action === 'QUERY') {
//           const result = await sql.query(chatGptAnswerObject.message);
//
//           messageHistory.push({
//             "role": "user",
//             "content": "The response you got from the database is:" + JSON.stringify(result.recordset)
//           })
//
//           chatGptAnswerObject = await getChatGptAnswerObject(messageHistory);
//           messageHistory.push(chatGptAnswerObject)
//           return (messageHistory)
//         }
//         break
//       case 'USER':
//         console.log('user case')
//         console.log('returning message history')
//         // console.log(messageHistory)
//         return (messageHistory)
//
//       case 'ASSISTANT':
//         console.log("ODD ASS BEHAVIOR")
//         // messageHistory.push(chatGptAnswerObject)
//         return (JSON.stringify(messageHistory))
//       default:
//         console.log('Something went wrong')
//         throw new Error('Something went wrong')
//     }
//   } catch (e) {
//     console.log(e)
//     console.log('catching and retrying')
//     console.log(messageHistory)
//     messageHistory.push({
//       "role": "system",
//       "content": "Please repeat that answer but use valid JSON only like \"recipient\": \"SERVER\", \"action\": \"QUERY\", \"message\":\"SELECT COUNT(*) FROM test.dbo.Venues;\" and no other text or explanation. This is not acceptable answer: 'Here is your answer in valid JSON: {\"recipient\":\"SERVER\", \"action\":\"QUERY\", \"message\":\"SELECT COUNT(*) FROM test.dbo.Venues;\"}'"
//     })
//     await getChatGptAnswerObject(messageHistory);
//   }
// }

//</editor-fold>

// <editor-fold desc="Routes">
app.get('/', (req, res) => {
    res.send('SQL ChatGpt server operational!');
});


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
        "content": "From now you will only ever respond with JSON. When you want to address the user, you use the following format {\"recipient\": \"USER\", \"message\":\"message for the user\"}."
    },
    // {"role": "assistant", "content": "{\"recipient\": \"USER\", \"message\":\"I understand.\"}."},
    {
        "role": "system",
        "content": "You can address the SQL Server by using the SERVER recipient. When calling the server, you must also specify an action. The action can be QUERY when you want to QUERY the database. The format you will use for executing a query is as follows: {\"recipient\":\"SERVER\", \"action\":\"QUERY\", \"message\":\"SELECT SUM(OrderQty) FROM Sales.SalesOrderDetail;\"}"
    },
    {
        "role": "system",
        "content": "if you need to query the database to answer information you're supposed to write the query in the message part of the JSON as specified earlier and repeated here {\"recipient\":\"SERVER\", \"action\":\"QUERY\", \"message\":\"SELECT SUM(OrderQty) FROM Sales.SalesOrderDetail;\"}"
    },
    {
        "role": "system",
        "content": "you cannot tell the user to execute a query, you must do it yourself by sending a message to the server. like this {\"recipient\":\"SERVER\", \"action\":\"QUERY\", \"message\":\"SELECT SUM(OrderQty) FROM Sales.SalesOrderDetail;\"}"
    }, {
        "role": "system",
        "content": "you will not tell that the answer is a query for the user such as 'The query for the number of venues is: SELECT COUNT(*) FROM test.dbo.Venues;', you must do it yourself by sending a message to the server like this {\"recipient\":\"SERVER\", \"action\":\"QUERY\", \"message\":\"SELECT SUM(OrderQty) FROM Sales.SalesOrderDetail;\"}"
    }, {
        "role": "system",
        "content": "you will not tell that the answer is a query for the user such as  'The number of venues we have is: SELECT COUNT(*) FROM test.dbo.Venues;', you must do it yourself by sending a message to the server like this {\"recipient\":\"SERVER\", \"action\":\"QUERY\", \"message\":\"SELECT SUM(OrderQty) FROM Sales.SalesOrderDetail;\"}"
    },

]

app.post('/allDbsAndSchemas', async (req, res) => {
    if (!sql) {
        res.status(500).send('Something went wrong');
        return
    }

    const userQuery = req.body.userQuery
    if (!userQuery) {
        console.log('no user query')
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
    // console.log(databasesTablesColumns)
    console.log('startMessageStack')
    console.log(startMessageStack)
    let messageHistory = _.cloneDeep(startMessageStack)
    // console.log('messageHistory')
    // console.log(messageHistory)
    messageHistory.push({
        "role": "system",
        "content": "here is the json with all databases, tables and columns with data types: " + JSON.stringify(databasesTablesColumns)
    })

    messageHistory.push(userQuery)
    let getUpdatedMessageHistory;
    try {
        getUpdatedMessageHistory = await getChatGptAnswerObject(messageHistory);
    } catch (e) {
        console.log("send status 2")
        console.log(e)
        return res.status(500).json('Something went wrong')
    }

    console.log('send status 3')
    // console.log(getUpdatedMessageHistory)
    messageHistory = []
    if (getUpdatedMessageHistory) {
        return res.send(JSON.safeStringify(getUpdatedMessageHistory))
    } else return res.status(500).send('Something went wrong')
});



// Catch all requests
app.get('*', function (req, res) {
    res.sendStatus(404);
})

//</editor-fold>
