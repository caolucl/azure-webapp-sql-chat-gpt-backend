const sql = require('mssql');
const dotenv = require('dotenv');
dotenv.config();

// TODO: SQL CONNECTION
console.log(process.env.SQL_USER)
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

// Function to connect to the SQL Server and populate tables
async function main() {
    try {
        // Create a new SQL Server connection pool
        await sql.connect(config);

        // Populate each table with random dummy data
        await populateUsersTable(1000);
        await populateProductsTable(1000);
        await populateOrdersTable(1000);
        await populateOrderItemsTable(1000);
        await populatePaymentsTable(1000);

        console.log('Tables populated successfully');

        // Close the connection pool
        await sql.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

// Function to generate a random username
function generateRandomUsername() {
    const usernames = [
        'user123', 'john_doe', 'jane_smith', 'cool_user', 'test_user', 'username123',
        'user_1', 'user_2', 'user_3', 'user_4', 'user_5', 'user_6', 'user_7', 'user_8',
        // Add more usernames as needed
    ];
    const randomIndex = Math.floor(Math.random() * usernames.length);
    return usernames[randomIndex] + randomIndex;
}

// Function to generate random email
function generateRandomEmail() {
    const domain = '@example.com';
    return generateRandomUsername().toLowerCase() + domain;
}

// Function to generate random password
function generateRandomPassword() {
    return Math.random().toString(36).slice(-8);
}

// Function to generate random decimal number within a range
function generateRandomDecimal(min, max) {
    return (Math.random() * (max - min) + min).toFixed(2);
}

// Function to generate random integer within a range
function generateRandomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to populate Users table with random data
async function populateUsersTable(numRows) {
    const request = new sql.Request();
    for (let i = 0; i < numRows; i++) {
        await request.query(`
      INSERT INTO Users (Username, Email, Password)
      VALUES ('${generateRandomUsername()}', '${generateRandomEmail()}', '${generateRandomPassword()}')
    `);
    }
}

// Function to populate Products table with random data
async function populateProductsTable(numRows) {
    const request = new sql.Request();
    for (let i = 0; i < numRows; i++) {
        await request.query(`
      INSERT INTO Products (Name, Description, Price, Stock)
      VALUES ('Product ${i + 1}', 'Description for Product ${i + 1}', ${generateRandomDecimal(1, 100)}, ${generateRandomInteger(1, 100)})
    `);
    }
}

// Function to populate Orders table with random data
async function populateOrdersTable(numRows) {
    const request = new sql.Request();
    for (let i = 0; i < numRows; i++) {
        await request.query(`
      INSERT INTO Orders (UserID, TotalAmount, Status)
      VALUES (${generateRandomInteger(1, 1000)}, ${generateRandomDecimal(1, 1000)}, 'Completed')
    `);
    }
}

// Function to populate OrderItems table with random data
async function populateOrderItemsTable(numRows) {
    const request = new sql.Request();
    for (let i = 0; i < numRows; i++) {
        await request.query(`
      INSERT INTO OrderItems (OrderID, ProductID, Quantity, Price)
      VALUES (${generateRandomInteger(1, 1000)}, ${generateRandomInteger(1, 1000)}, ${generateRandomInteger(1, 10)}, ${generateRandomDecimal(1, 100)})
    `);
    }
}

// Function to populate Payments table with random data
async function populatePaymentsTable(numRows) {
    const request = new sql.Request();
    for (let i = 0; i < numRows; i++) {
        await request.query(`
      INSERT INTO Payments (OrderID, Amount, PaymentMethod, Status)
      VALUES (${generateRandomInteger(1, 1000)}, ${generateRandomDecimal(1, 1000)}, 'Credit Card', 'Completed')
    `);
    }
}

// Call the main function to start the process
main();
