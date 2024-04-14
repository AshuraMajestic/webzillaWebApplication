require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 1234;
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require("path");
const hbs = require("hbs");
const cors = require("cors");
const { userRef, shopRef, visitorRef } = require("./conn/connection.js");
const cron = require('node-cron');
// Set up CORS
app.use(cors());

// Define paths
const staticPath = path.join(__dirname, "../public");
const bootstrapPath = path.join(__dirname, "../node_modules/bootstrap/dist");
const jqueryPath = path.join(__dirname, "../node_modules/jquery/dist");
const templatePath = path.join(__dirname, "../Templates/views");
const partialsPath = path.join(__dirname, "../Templates/partials");

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use("/jq", express.static(jqueryPath));
app.use(express.static(staticPath));
app.use(express.static(bootstrapPath));
app.set("view engine", "hbs");
app.set("views", templatePath);
hbs.registerPartials(partialsPath);
app.use(cookieParser());
app.use(express.json());
app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true
}));



// Helper
hbs.registerHelper('multiply', function (a, b) {
    return a * b;
});


hbs.registerHelper('ifIndexEquals', function (index, value, options) {
    if (index === value) {
        return options.fn(this);
    } else {
        return options.inverse(this);
    }
});



hbs.registerHelper('jsonStringify', function (context) {
    return JSON.stringify(context);
});
hbs.registerHelper('ifOdd', function (index, options) {
    if (index % 2 === 1) {
        return options.fn(this);
    } else {
        return options.inverse(this);
    }
});
hbs.registerHelper('compare', function (a, b, options) {
    if (a === b) {
        return options.fn(this);
    } else {
        return options.inverse(this);
    }
});

// Function to track site visit and add 0 for new date
const trackSiteVisit = async (link) => {
    try {
        // Get current date in the format "EEE MMM dd yyyy"
        const currentDate = new Date();
        const date = currentDate.toISOString().split('T')[0]; // Get date as yyyy-mm-dd string

        // Check if the current date entry exists in the database
        const visitCountRef = visitorRef.child(link).child(date);
        const visitCountSnapshot = await visitCountRef.once('value');

        // If the current date entry doesn't exist, add it with a visitor count of 0
        if (!visitCountSnapshot.exists()) {
            await visitCountRef.set(0);
        }

        // Increment visit count for the specific link and date
        await visitCountRef.transaction(currentCount => currentCount + 1);
    } catch (error) {
        console.error('Error tracking site visit:', error);
    }
};

// Schedule the trackSiteVisit function to run daily at midnight
cron.schedule('0 0 * * *', () => {
    // Loop through all links to track site visit and add 0 for new date
    userRef.once("value", (snapshot) => {
        snapshot.forEach((childSnapshot) => {
            const link = childSnapshot.val().link;
            trackSiteVisit(link);
        });
    });
}, {
    timezone: "Asia/Kolkata" // Set your timezone here
});

// Function to generate a unique order number
const generateOrderNumber = async (link) => {
    try {
        // Check if the orderCount node exists, if not, initialize it to 0
        const orderCountRef = shopRef.child(link).child("orderCount");
        await orderCountRef.transaction(currentCount => currentCount === null ? 0 : currentCount);

        // Increment the order counter
        await orderCountRef.transaction(currentCount => (currentCount || 0) + 1);

        // Get the updated counter value
        const snapshot = await orderCountRef.once("value");
        const orderCount = snapshot.val();
        return orderCount;
    } catch (error) {

        throw error;
    }
};


// Function to add product to cart
const addToCart = async (req, link) => {
    try {
        const { productName, productPrice, productImage, quantity, size, color, subtotal } = req.body;
        req.session[link] = req.session[link] || {};
        const cart = req.session[link].cart || {}; // Retrieve cart data from session
        if (productName in cart) {
            // If product already exists in cart, update quantity
            cart[productName].quantity += parseInt(quantity);
        } else {
            // If product is not in cart, add it
            cart[productName] = {
                productName: productName,
                productPrice: parseFloat(productPrice),
                productImage: productImage,
                quantity: parseInt(quantity),
                size: size,
                color: color,
                subtotal: parseFloat(subtotal)
            };
        }
        req.session[link] = req.session[link] || {};
        req.session[link].cart = cart; // Save updated cart data to session
        const cartItemCount = Object.keys(cart).length;
        return { success: true, message: 'Product added to cart successfully', cartItemCount: cartItemCount };
    } catch (error) {

        return { success: false, error: 'Error adding product to cart', message: error.message };
    }
};

// Function to save form data and cart data to the database and redirect to /placed after success
// Function to save form data and cart data to the database and redirect to /placed after success
const saveFormDataAndRedirect = async (req, res, formData, link, cart) => {
    try {
        let totalQuantity = 0;
        let totalPrice = 0;

        // Calculate total quantity and total price
        for (const item of Object.values(cart)) {
            totalQuantity += Number(item.quantity);
            totalPrice += item.quantity * item.productPrice;
        }
        // Generate a unique order number
        const orderNumber = await generateOrderNumber(link);
        const currentDate = new Date();
        const date = currentDate.toISOString().split('T')[0]; // Get date as yyyy-mm-dd string

        const orderData = {
            orderNumber: orderNumber,
            formData: formData,
            cart: cart,
            totalQuantity: totalQuantity,
            totalPrice: totalPrice,
            date: date,
            accepted: 'pending'
        };

        // Save order data to the database
        await shopRef.child(link).child("Orders").child(orderNumber).set(orderData);
        const userSnapshot = await userRef.orderByChild("link").equalTo(link).once("value");
        const userData = userSnapshot.val();

        if (!userData) {
            return res.status(404).send("User not found or not online");
        }
        const userId = Object.keys(userData)[0];
        const shopSnapshot = await shopRef.child(link).once("value");
        const shopData = shopSnapshot.val();

        if (!shopData) {
            return res.status(404).send("Shop data not found");
        }

        const logoUrl = shopData.ShopLogo.logoUrl;
        const bannerUrl = shopData.ShopLogo.bannerUrl;
        const products = shopData.Products;
        req.session[link].cart = {};
        // Redirect to the /placed page with the order number and form data
        res.render("placed", {
            shopname: userData[userId].shopname,
            address: userData[userId].address,
            email: userData[userId].email,
            logoLink: logoUrl,
            Banner: bannerUrl,
            productdata: products,
            cartdata: cart,
            link: link,
            formData: formData,
            orderNumber: orderNumber
        });
    } catch (error) {
        // If an error occurs, send an error response
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
};


// Function to handle user route creation
const createUserRoute = async (link) => {

    app.get(`/${link}`, async (req, res) => {
        try {
            const userSnapshot = await userRef.orderByChild("link").equalTo(link).once("value");
            const userData = userSnapshot.val();

            if (!userData) {
                return res.status(404).send("User not found or shop is offline");
            }

            const userId = Object.keys(userData)[0];
            if (!userData[userId].online) {
                return res.status(404).send("User not found or shop is offline");
            }
            const shopSnapshot = await shopRef.child(link).once("value");
            const shopData = shopSnapshot.val();

            if (!shopData) {
                return res.status(404).send("Shop data not found");
            }

            const logoUrl = shopData.ShopLogo.logoUrl;
            const bannerUrl = shopData.ShopLogo.bannerUrl;
            const products = Object.values(shopData.Products).filter(product => product.available === true);
            const Category = shopData.Category;
            let categoryLength = Object.keys(Category).length
            let StringedProductData = JSON.stringify(products);
            await trackSiteVisit(link);
            res.render("index", { shopname: userData[userId].shopname, address: userData[userId].address, email: userData[userId].email, logoLink: logoUrl, Banner: bannerUrl, productdata: products, link: link, category: Category, categoryLength: categoryLength, StringedProductData: StringedProductData });
        } catch (error) {

            res.status(500).send("Internal Server Error" + error);
        }
    });
    app.get(`/${link}/categoryPage`, async (req, res) => {
        try {
            const userSnapshot = await userRef.orderByChild("link").equalTo(link).once("value");
            const userData = userSnapshot.val();
            if (!userData) {
                return res.status(404).send("User not found");
            }

            const userId = Object.keys(userData)[0];
            if (!userData[userId].online) {
                return res.status(404).send("User not found or shop is offline");
            }
            const shopSnapshot = await shopRef.child(link).once("value");
            const shopData = shopSnapshot.val();

            if (!shopData) {
                return res.status(404).send("Shop data not found");
            }

            const logoUrl = shopData.ShopLogo.logoUrl;
            const bannerUrl = shopData.ShopLogo.bannerUrl;
            const products = Object.values(shopData.Products).filter(product => product.available === true);
            const Category = shopData.Category;
            let categoryLength = Object.keys(Category).length
            let StringedProductData = JSON.stringify(products);
            res.render("categoryPage", { shopname: userData[userId].shopname, address: userData[userId].address, email: userData[userId].email, logoLink: logoUrl, Banner: bannerUrl, productdata: products, link: link, category: Category, categoryLength: categoryLength, StringedProductData: StringedProductData });
        } catch (error) {

            res.status(500).send("Internal Server Error" + error);
        }
    });




    app.get(`/${link}/productDetail`, async (req, res) => {
        try {
            const name = req.query.name;
            // Query your database to get the product details based on the product name
            const productSnapshot = await shopRef.child(link).child("Products").child(name).once("value");

            let productData;
            // Check if the product exists
            if (productSnapshot.exists()) {
                productData = productSnapshot.val();
            } else {
                console.log("Product not found");

                return res.status(404).send("Product not found");
            }

            const userSnapshot = await userRef.orderByChild("link").equalTo(link).once("value");
            const userData = userSnapshot.val();
            if (!userData) {
                return res.status(404).send("User not found");
            }

            const userId = Object.keys(userData)[0];
            if (!userData[userId].online) {
                return res.status(404).send("User not found or shop is offline");
            }
            const shopSnapshot = await shopRef.child(link).once("value");
            const shopData = shopSnapshot.val();

            if (!shopData) {
                return res.status(404).send("Shop data not found");
            }

            const logoUrl = shopData.ShopLogo.logoUrl;
            const bannerUrl = shopData.ShopLogo.bannerUrl;
            const products = shopData.Products;
            res.render("productDetail", {
                shopname: userData[userId].shopname,
                address: userData[userId].address,
                email: userData[userId].email,
                logoLink: logoUrl,
                Banner: bannerUrl,
                productdata: products,
                link: link,
                product: productData
            });
        } catch (error) {
            console.error("Error fetching product details:", error);
            res.status(500).send("Internal Server Error");
        }
    });

    app.post(`/${link}/order`, async (req, res) => {
        try {
            const link = req.body.link;
            req.session[link] = req.session[link] || {};
            const cart = req.session[link].cart || {};
            if (!link) {
                return res.status(400).json({ error: 'Bad Request', message: 'Missing link in form data' });
            }
            // Save form data to database and redirect to /placed after success
            await saveFormDataAndRedirect(req, res, req.body, link, cart);

        } catch (error) {

            res.status(500).json({ error: 'Internal Server Error' + error, message: error.message });
        }
    });


    // Route to modify Cart
    app.post(`/${link}/updateCartItem`, (req, res) => {
        try {
            const { productName, newQuantity } = req.body;
            if (!productName || !newQuantity) {
                return res.status(400).json({ error: 'Bad Request', message: 'Missing required fields' });
            }
            req.session[link] = req.session[link] || {};
            const cart = req.session[link].cart || {};

            if (!cart[productName]) {
                return res.status(404).json({ error: 'Not Found', message: 'Product not found in cart' });
            }

            cart[productName].quantity = newQuantity;

            // Update subtotal for the specific product
            const price = parseFloat(cart[productName].productPrice);
            const subtotal = price * Number(newQuantity);
            cart[productName].subtotal = subtotal;

            req.session[link].cart = cart;
            res.status(200).send('Quantity updated successfully');
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
    });

    app.post(`/${link}/deleteCartItem`, (req, res) => {
        try {
            const productName = req.body.productName;
            if (!productName) {
                return res.status(400).json({ error: 'Bad Request', message: 'Missing product name' });
            }
            req.session[link] = req.session[link] || {};
            const cart = req.session[link].cart || {};

            if (!cart[productName]) {
                return res.status(404).json({ error: 'Not Found', message: 'Product not found in cart' });
            }

            delete cart[productName];
            req.session[link].cart = cart;
            res.status(200).json({ message: 'Item deleted successfully' });
        } catch (error) {

            res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
    });

    // Route to add product to cart
    app.post(`/${link}/productDetail/addToCart`, async (req, res) => {
        try {

            const result = await addToCart(req, link);

            if (result.success) {
                res.status(200).json({ message: result.message, cartItemCount: result.cartItemCount });
            } else {
                res.status(500).json({ error: result.error, message: result.message });
            }
        } catch (error) {

            res.status(500).json({ error: 'Error adding product to cart', message: error.message });
        }
    });

    app.get(`/${link}/Cart`, async (req, res) => {
        try {
            req.session[link] = req.session[link] || {};
            req.session[link].cart = req.session[link].cart || {};

            const cartData = req.session[link].cart;
            const userSnapshot = await userRef.orderByChild("link").equalTo(link).once("value");
            const userData = userSnapshot.val();

            if (!userData) {
                return res.status(404).send("User not found");
            }

            const userId = Object.keys(userData)[0];
            if (!userData[userId].online) {
                return res.status(404).send("User not found or shop is offline");
            }
            const shopSnapshot = await shopRef.child(link).once("value");
            const shopData = shopSnapshot.val();

            if (!shopData) {
                return res.status(404).send("Shop data not found");
            }

            const logoUrl = shopData.ShopLogo.logoUrl;
            const bannerUrl = shopData.ShopLogo.bannerUrl;
            res.render('Cart', {
                cartData: cartData, shopname: userData[userId].shopname, address: userData[userId].address,
                email: userData[userId].email, logoLink: logoUrl, Banner: bannerUrl, link: link
            });
        } catch (error) {
            console.log(error);

            res.status(500).send("Internal Server Error" + error);
        }
    });
    app.get(`/${link}/ordered`, async (req, res) => {
        try {

            const userSnapshot = await userRef.orderByChild("link").equalTo(link).once("value");
            const userData = userSnapshot.val();

            if (!userData) {
                return res.status(404).send("User not found");
            }

            const userId = Object.keys(userData)[0];
            const shopSnapshot = await shopRef.child(link).once("value");
            const shopData = shopSnapshot.val();

            if (!shopData) {
                return res.status(404).send("Shop data not found");
            }

            const logoUrl = shopData.ShopLogo.logoUrl;
            const bannerUrl = shopData.ShopLogo.bannerUrl;
            res.render('ThankYou', {
                shopname: userData[userId].shopname, address: userData[userId].address,
                email: userData[userId].email, logoLink: logoUrl, Banner: bannerUrl, link: link
            });
        } catch (error) {

            res.status(500).send(error);
        }
    });

    app.get(`/${link}/checkout`, async (req, res) => {
        const userSnapshot = await userRef.orderByChild("link").equalTo(link).once("value");
        const userData = userSnapshot.val();

        if (!userData) {
            return res.status(404).send("User not found");
        }

        const userId = Object.keys(userData)[0];
        if (!userData[userId].online) {
            return res.status(404).send("User not found or shop is offline");
        }
        const shopSnapshot = await shopRef.child(link).once("value");
        const shopData = shopSnapshot.val();

        if (!shopData) {
            return res.status(404).send("Shop data not found");
        }

        const logoUrl = shopData.ShopLogo.logoUrl;
        const bannerUrl = shopData.ShopLogo.bannerUrl;
        // Retrieve necessary data from session or database
        req.session[link] = req.session[link] || {};
        const cartData = req.session[link].cart || {}; // Retrieve cart data from session
        // Render the checkout page and pass necessary data
        res.render('CheckOut', {
            cartData: cartData, shopname: userData[userId].shopname, address: userData[userId].address,
            email: userData[userId].email, logoLink: logoUrl, Banner: bannerUrl, link: link
        });
    });
};

// Create routes for existing users
userRef.once("value", (snapshot) => {
    snapshot.forEach((childSnapshot) => {
        const link = childSnapshot.val().link;
        createUserRoute(link);
    });
});

// Dynamically add routes for new users
userRef.on("child_added", (snapshot) => {
    const link = snapshot.val().link;
    createUserRoute(link);
});

// Route for rendering the "Thank You" page
app.get('/:link/placed', async (req, res) => {
    try {
        const orderNumber = req.query.orderNumber;
        if (!orderNumber) {
            return res.status(400).send("Bad Request: Missing order number");
        }

        // Render the "Thank You" page and pass the order number
        res.render('ThankYou', { orderNumber: orderNumber });
    } catch (error) {
        res.status(500).send("Internal Server Error" + error);
    }
});

// Ignore requests for favicon.ico
app.get("/favicon.ico", (req, res) => res.status(204));

// Start the server
app.listen(port, () => {
    console.log("Listening");
});