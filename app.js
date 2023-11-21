require('dotenv').config()
const express = require('express')
const ejs = require('ejs')
const bodyParser = require('body-parser')
const mongoose = require('mongoose')
const session = require('express-session')
const passport = require('passport')
const passportLocalMongoose = require('passport-local-mongoose')
const nodemailer = require('nodemailer');
const paypal = require('paypal-rest-sdk')
const moment = require('moment');
const multer = require('multer')
const path = require('path')
const axios = require('axios');
const braintree = require('braintree');


paypal.configure({
    mode: 'live', 
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret:process.env.PAYPAL_SECRET_KEY,
})

const PUBLISHABLE_KEY = process.env.STRIPE_PUBLISH_KEY
const SECRET_KEY = process.env.STRIPE_SECRET_KEY
const stripe  = require('stripe')(SECRET_KEY)



const Storage = multer.diskStorage({
    destination: (req,file,cb)=>{
        cb(null,'public/uploads/')
    },

    filename:(req,file,cb)=>{
        console.log(file)
        cb(null,Date.now() +  path.extname(file.originalname))
    }
})

const upload = multer({storage: Storage})


const app = express()
const PORT = process.env.PORT || 3000

//mongoose.connect('mongodb://localhost:27017/ForexDb')
mongoose.connect(process.env.DATABASE_URL,(err)=>{
    if(err){
        console.log(err)
    }else{
        console.log('sucessfully connected to database')
    }
})

//useage of app
app.use(express.static('public'))
app.set('view engine','ejs')
app.use(bodyParser.urlencoded({extended:true}))
app.use(bodyParser.json())
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret:process.env.SECRET,
    resave:false,
    saveUninitialized:false
}))
app.use(passport.initialize())
app.use(passport.session())

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        unique: true,
    },
    username: {
        type: String,
        unique: true,
    },
    password: String,
    profileImage: {
        type: String 
    },
    admin: {
        type: Boolean,
         default: false,
    } ,
    contract: {
          type: String,
          enum: ['starter', 'pro', 'golden','false'],
          default: 'false' ,
          
        },
        totalSpent: {
            type: Number,
            default: 0, // Initialize to 0 if not provided
        },
        contractExpiration: Date ,
        onlineClasses: {
            type: Boolean,
            default: false,
        },
    
      });
  
// Forex Signal Schema
const forexSignalSchema = new mongoose.Schema({
    action: String,
    currency: String,
    price: String,
    stopLoss: String,
    takeProfit: String,
    proof:String,
    updatedTime:String
  });
const VideoSchema = new mongoose.Schema({
    title: String,
    videoPath: String,
    
  });
  
  
  
  

  

userSchema.plugin(passportLocalMongoose)

const Video = mongoose.model('Video', VideoSchema);

const ForexSignal = mongoose.model('ForexSignal', forexSignalSchema);

const User = new mongoose.model("User", userSchema)

passport.use(User.createStrategy())
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    User.findById(id, (err, user) => {
        done(err, user);
    });
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    // Redirect unauthenticated users to the login page or any other appropriate route
    res.redirect('/login');
}
const isAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.admin) {
        return next(); 
    }
    res.redirect('/dash'); 
};

//get routs


  
const apiKey = '6d10b51c0c-6d16156355-s423xt';

app.get('/chart', ensureAuthenticated, async (req, res) => {
    try {
      const user = req.user
      const specificCurrencies = ['USD', 'GBP', 'JPY'];
      let forexData = {};
  
      for (const currency of specificCurrencies) {
        const apiUrl = `https://api.fastforex.io/fetch-multi?from=EUR&to=USD,GBP,JPY,CAD,AUD&api_key=${apiKey}`;
        const response = await axios.get(apiUrl);
  
        if (response.status === 200) {
          forexData = response.data.results;
        } else {
          console.error(`Failed to fetch Forex data for ${currency}`);
          return res.status(500).json({ error: `Failed to fetch Forex data for ${currency}` });
        }
      }
      
      console.log(forexData)
      console.log(user)
      // Render the EJS template with the filtered forex data
      res.render('forexChart', { forexData ,user}); // Pass the forexData object to the template
    } catch (error) {
      console.error('Error fetching forex data:', error);
      res.status(500).json({ error: 'Failed to fetch Forex data' });
    }
  });
  
  let due ;
  
  app.post('/visa',ensureAuthenticated,(req,res)=>{
    const user = req.user
    due = parseFloat(req.body.amount)

    if(due === 200){
        due = 20000
    }else if(due === 15){
        due= 1500
    }else if(due === 30){
        due = 3000
    }else{
        due = 0 
        return 0
    }
   
    res.render('visa',{user ,key:PUBLISHABLE_KEY, due})
  })
  


app.get('/',(req,res)=>{
    res.render('home')
})
app.get('/admin',isAdmin, async(req,res)=>{
    
    
    try {
        const user = req.user
         
        // Fetch signals from the database
        const signals = await ForexSignal.find({}, '-_id action currency price stopLoss takeProfit proof updatedTime').lean();
         
         const allUsers = await User.find({});
         const videos = await Video.find(); 
          // Calculate total sales/spending
        const totalSales = allUsers.reduce((accumulator, currentUser) => {
            return accumulator + currentUser.totalSpent;
        }, 0);

        ForexSignal.countDocuments({}, (err, count) => {
            if (err) {
                console.error('Error:', err);
            } else {
               
                res.render('admin', { user,signals,count , totalSales,videos});
            }
        });

        
      } catch (error) {
        res.status(500).send('Error fetching signals!');
      }
})

app.get('/update-signal',isAdmin,(req,res)=>{
    const user = req.user
    res.render('update-signal',{user})
})
app.get('/allContract',isAdmin,async(req,res)=>{
    
    try {
        // Fetch users with any type of contract
        const user = req.user
        const usersWithContracts = await User.find({ contract: { $ne: 'false' } }); 

        const countContracts = await User.countDocuments({ contract: { $ne: 'false' } });
        


        res.render('usersWithContracts', { usersWithContracts,user,countContracts }); 
    } catch (error) {
        res.status(500).json({ error: 'Error fetching users with contracts' });
    }


})
app.get('/allUsers',isAdmin, async(req,res)=>{

    try {
        const allUsers = await User.find();
        const user = req.user
        const countUsers = await User.countDocuments({});
        res.render('allUsers', { allUsers,user,countUsers }); 
    } catch (error) {
        res.status(500).send('Error fetching users');
    }

})  

app.get('/edit-user/:userId', isAdmin,(req, res) => {
    const userId = req.params.userId; 

    
    User.findById(userId, (err, user) => {
        if (err || !user) {
            // Handle error or user not found
            res.status(404).send('User not found');
        } else {
            // Render the edit user page with the user data
            res.render('edit-user', { user });
        }
    });
});

app.get('/login',(req,res)=>{
    res.render('login')
})
app.get('/logout',(req,res)=>{
    req.logout((err)=>{
        if(err){
            console.log(err)
        }else{
            res.redirect('/')
        }
    })
})
app.get('/online-classes',ensureAuthenticated,async(req,res)=>{

    const user = req.user
    const videos = await Video.find(); 
   
    if (user.admin) {
        res.render('admin-classes', { user, videos });
    } else {
        res.render('online-classes', { user, videos });
    }
    
    
})

app.get('/dash', async(req, res) => {
    if (req.isAuthenticated()) {
        const user = req.user;

        // Check if the user's contract has expired
        if (user.contract !== 'false' && user.contractExpiration && Date.now() >= user.contractExpiration) {
            // Contract has expired, reset to 'false'
            function sendEmailConfirmation(){

                // Send a confirmation email to the user
                const senderEmail = req.user.username;
                
                const subject = 'Contract Cancelation';
        
                const emailTemplate = `
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Contract Expiring</title>
                        </head>
                        <body style="font-family: Arial, sans-serif;">
        
                            <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                                <h2 style="color: red;">Your Contract has Expired</h2>
                            </div>
        
                            <div style="padding: 20px;">
                                <p>Here is your Contract details:</p>
                                
                                <ul style="list-style-type: none; padding: 0; margin: 0;">
                                    <li>User: <strong>${senderEmail}</strong></li>
                                    <li>Contract: <strong>${user.contract}</strong></li> 
                                    <li>Expiring at: <strong>${user.contractExpiration || Date.now()}</strong></li> 
                                
                                    
                                </ul>
                            </div>
        
                            <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                                <p style="color: #888;">Thank you for choosing FX AI!</p>
                            </div>
        
                        </body>
                        </html>
                    `;
        
        
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    port: 456,
                    secure: true,
                    auth:{
                        user: "teamdevelopers72@gmail.com",
                        pass:"tpqe yuyw rvnt cxmi"
                    }
                });
        
                const mailOptions = {
                    from: 'teamdevelopers72@gmail.com',
                    to: senderEmail,
                    subject: subject,
                    html: emailTemplate,
                };
        
                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.error('Error sending email notification:', error);
                    } else {
                        console.log('Email notification sent:', info.response);
                    }
                });
            }

            user.contract = 'false';
            user.onlineClasses = false
            user.save((error) => {
                if (error) {
                    console.error('Error resetting user contract:', error);
                } else {
                    console.log('User contract reset successfully:', user);
                    sendEmailConfirmation()
                }
            });
        }
             // Fetch signals from the database
            const signals = await ForexSignal.find({}, '-_id action currency price stopLoss takeProfit proof updatedTime').lean();
            console.log(signals)
            ForexSignal.countDocuments({}, (err, count) => {
                if (err) {
                    console.error('Error:', err);
                } else {
                    console.log('Total number of signals:', count);
                    res.render('dash', { user,signals,count});
                }
            });
    } else {
        res.redirect('/login');
    }
});


app.get('/contact',ensureAuthenticated , (req,res)=>{
    const user = req.user
    res.render('contact',{user})
})
app.get('/profile',ensureAuthenticated,(req,res)=>{
    const user = req.user
    res.render('profile',{user})

})
app.get('/contract',ensureAuthenticated,(req,res)=>{
    const user = req.user
    res.render('contract',{user})
})

// Payment success route
let amount ;
let totalAmount = {}

app.get('/payment_success', async (req, res) => {
    
    function paymentNotification(){
        // Send a confirmation email to the user
        const userEmail = req.user.username; // Assuming you have the user's email address
        const subject = 'New payment received from your website';
        const message = `A new user ${userEmail} has bought $${amount} credits`;

        // Create a transporter object using your email credentials
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: "darkunlocks1@gmail.com",
                pass: "nnzw lyec ivtj soyw"
            }
        });

        // Create and send the email notification
        const mailOptions = {
            from: 'darkunlocks1@gmail.com',
            to: 'strongadas009@gmail.com',
            subject: subject,
            text: message,
        };

        const info =  transporter.sendMail(mailOptions);
        console.log('Email notification sent:', info.response);
    }
   

    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    const userId = req.user._id;

    // Check if payerId, paymentId, and userId are valid
    if (!payerId || !paymentId || !userId) {
        console.error("Invalid parameters.");
        return res.redirect('/payment_cancel');
    }

    const execute_payment_json = {
        "payer_id": payerId,
        "transactions": [{
            "amount": totalAmount
        }]
    };

    console.log("payerId:", payerId);
    console.log("amount:", totalAmount);

    paypal.payment.execute(paymentId, execute_payment_json, async (err, payment) => {
        if (err) {
            console.error(err.response);
            return res.redirect('/payment_error');

        } else {

            console.log("Payment successful");
            //console.log(JSON.stringify(payment));

            try {
                // Retrieve the user by their ID
                const user = await User.findById(userId);

                if (!user) {
                    console.error("User not found.");
                    return res.redirect('/payment_error');
                }

                //adding the contract to users
                    // Determine the new contract based on the amount
                let newContract;
                let newOnlineClasses;
                if (amount === 15.00) {
                    console.log('Starter');
                    newContract = 'starter';
                    newOnlineClasses = false

                } else if (amount === 30.00) {
                    console.log('Pro');
                    newContract = 'pro';
                    newOnlineClasses = false

                } else if (amount >= 200.00) {
                    console.log('Golden');
                    newContract = 'golden';
                    newOnlineClasses = true
                    
                } else {
                    console.log('No Plan found');
                    newContract = 'false';
                }

                // Update user's contract and totalSpent
                user.contract = newContract;
                user.totalSpent += amount;
                user.onlineClasses = newOnlineClasses

               // Calculate the contract expiration date (30 days from now)
                const currentTimestamp = Date.now();
                const daysInMilliseconds = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
                const contractExpiration = new Date(currentTimestamp + daysInMilliseconds);

                user.contractExpiration = contractExpiration;


                // Save the updated user
                await user.save();
                function sendEmialConfirmation(){

                    // Send a confirmation email to the user
                    const senderEmail = req.user.username;
                    const amountToSend = amount
                    const subject = 'Contract Confirmation';
            
                    const emailTemplate = `
                            <!DOCTYPE html>
                            <html lang="en">
                            <head>
                                <meta charset="UTF-8">
                                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                <title>Contract Confirmation</title>
                            </head>
                            <body style="font-family: Arial, sans-serif;">
            
                                <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                                    <h2 style="color: #4CAF50;">Your Contract was Successfully Activated</h2>
                                </div>
            
                                <div style="padding: 20px;">
                                    <p>Here is your Contract details:</p>
                                    
                                    <ul style="list-style-type: none; padding: 0; margin: 0;">
                                        <li>User: <strong>${senderEmail}</strong></li>
                                        <li>Contract: <strong>${user.contract}</strong></li> 
                                        <li>Expiring at: <strong>${user.contractExpiration}</strong></li> 
                                        <li>Amount: <strong>$ ${amount}</strong></li>
                                        
                                    </ul>
                                </div>
            
                                <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                                    <p style="color: #888;">Thank you for choosing FX AI!</p>
                                </div>
            
                            </body>
                            </html>
                        `;
            
            
                    const transporter = nodemailer.createTransport({
                        service: 'gmail',
                        port: 456,
                        secure: true,
                        auth:{
                            user: "teamdevelopers72@gmail.com",
                            pass:"tpqe yuyw rvnt cxmi"
                        }
                    });
            
                    const mailOptions = {
                        from: 'teamdevelopers72@gmail.com',
                        to: senderEmail,
                        subject: subject,
                        html: emailTemplate,
                    };
            
                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error('Error sending email notification:', error);
                        } else {
                            console.log('Email notification sent:', info.response);
                        }
                    });
                }
                
                // Render the success page with the updated balance
                res.render("payment_success", {user,amount,contractExpiration});
                paymentNotification()
                sendEmialConfirmation()

            } catch (error) {
                console.error('Error occurred while processing user or sending email:', error);
                res.redirect('/payment_error');
            }
        }

        
    });
});



app.get('/payment_error', ensureAuthenticated,(req, res) => {
    const paymentStatus = req.query.status; // Get the payment status query parameter
    console.log("payment ",paymentStatus)
    // Render the 'cancelled' view with the payment status
    res.render('cancelled');
});

app.get('/payment', ensureAuthenticated, async(req, res) => {
    console.log(req.query.amount, typeof req.query.amount);
    console.log("email:", req.query.stripeEmail);
    console.log("strip:", req.query.stripeToken);

    stripe.customers.create({
        email: req.query.stripeEmail,
        source: req.query.stripeToken,
        name: req.user.name,
        address: {
            line1: '1155 South Street',
            postal_code: "0002",
            city: 'Pretoria',
            state: 'Gauteng',
            country: 'South Africa'
        }
    }, (err, customer) => {
        if (err) {
            console.error(err);
            return res.redirect('/payment_error');
        }
        
        console.log(customer);
        
        stripe.charges.create({
            amount: due,
            description: "Subscription Forex Ai",
            currency: 'USD',
            customer: customer.id,
        }, async(err, charge) => {
            if (err) {
                console.error(err);
                return res.send(err);
            }
            
        console.log(charge);
        const userId = req.user._id
            // Retrieve the user by their ID
        const user = await User.findById(userId);

        if (!user) {
            console.error("User not found.");
            return res.redirect('/payment_error');
        }

        // Determine the new contract based on the amount
        if(due === 20000){
            due = 200.00
        }else if(due === 1500){
            due= 15.00
        }else if(due === 3000){
            due = 30.00
        }else{
            due = 0 
            return 0
        }
        console.log(due)
         amount = due

        let newContract;
        let newOnlineClasses;
        if (due === 15.00) {
            newContract = 'starter';
            newOnlineClasses = false;
            
            
        } else if (due === 30.00) {
            newContract = 'pro';
            newOnlineClasses = false;
            
        } else if (due >= 200.00) {
            newContract = 'golden';
            newOnlineClasses = true;
            
        } else {
            newContract = 'false';
        }

        // Update user's contract and totalSpent
        user.contract = newContract;
        user.totalSpent += due;
        user.onlineClasses = newOnlineClasses;

        // Calculate the contract expiration date (30 days from now)
        const currentTimestamp = Date.now();
        const daysInMilliseconds = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
        const contractExpiration = new Date(currentTimestamp + daysInMilliseconds);

        user.contractExpiration = contractExpiration;


    
        // Save the updated user
        await user.save();

        // Send confirmation email to the user
        


         function sendEmialConfirmation(){

            // Send a confirmation email to the user
            const senderEmail = req.user.username;
            const amountToSend = amount
            const subject = 'Contract Confirmation';
    
            const emailTemplate = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Contract Confirmation</title>
                    </head>
                    <body style="font-family: Arial, sans-serif;">
    
                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <h2 style="color: #4CAF50;">Your Contract was Successfully Activated</h2>
                        </div>
    
                        <div style="padding: 20px;">
                            <p>Here is your Contract details:</p>
                            
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li>User: <strong>${senderEmail}</strong></li>
                                <li>Contract: <strong>${user.contract}</strong></li> 
                                <li>Expiring at: <strong>${user.contractExpiration}</strong></li> 
                                <li>Amount: <strong>$ ${amount}</strong></li>
                                
                            </ul>
                        </div>
    
                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <p style="color: #888;">Thank you for choosing FX AI!</p>
                        </div>
    
                    </body>
                    </html>
                `;
    
    
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                port: 456,
                secure: true,
                auth:{
                    user: "teamdevelopers72@gmail.com",
                    pass:"tpqe yuyw rvnt cxmi"
                }
            });
    
            const mailOptions = {
                from: 'teamdevelopers72@gmail.com',
                to: senderEmail,
                subject: subject,
                html: emailTemplate,
            };
    
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending email notification:', error);
                } else {
                    console.log('Email notification sent:', info.response);
                }
            });
        }
        
        sendEmialConfirmation()
        // Render the success page with updated data
        res.render("payment_success", { user, amount,due , contractExpiration });
        });
    });
});
// Express route to handle the view-proof page
app.get('/view-proof', (req, res) => {
    const imageUrl = req.query.img; // Get the image URL from the query parameter
    console.log(imageUrl)
    // Render an HTML page that displays the image
    res.render('view-proof', { imageUrl });
});


//post routs

app.post('/update-user/:userId', isAdmin,(req, res) => {
    const userId = req.params.userId; // Extract the userId from the URL parameters

    // Assuming you have a User model in Mongoose
    User.findByIdAndUpdate(userId, req.body, { new: true }, (err, updatedUser) => {
        if (err) {
            // Handle error
            res.status(500).send('Error updating user');
        } else {
            // Redirect to a page showing the updated user details or any other desired route
            res.redirect('/allUsers');
        }
    });
});

app.post('/update-video', isAdmin, upload.single('video'), async (req, res) => {
    try {
      const { title } = req.body;

      const videoPath = req.file ? req.file.filename : undefined;
        const videoClasses = new Video ({
            title,
            videoPath

        })

      await videoClasses.save((err)=>{
        console.log('Video updated successfully!')
      });
  
        res.redirect('admin-classes')
    } catch (err) {
      console.error(err);
      res.status(500).send('Error updating video');
    }
  });
  
 
app.post('/updateSignal',isAdmin,upload.single('proof'), async(req,res)=>{
    
    

    try {
        async function sendEmialConfirmation(){

            // Send a confirmation email to the user
            const allUsers = await User.find({}, 'username'); 
    
            // Extract emails from allUsers array
            const userEmails = allUsers.map(user => user.username);
    
            
            const currency = req.body.currency
            const subject = 'Forex Signal Update';
            const currentDate = new Date();
            const options = {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false // Set to true for 12-hour format
            };
    
            const formattedDate = currentDate.toLocaleString('en-US', options);
    
            const emailTemplate = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Forex Signal Update Confirmation</title>
                    </head>
                    <body style="font-family: Arial, sans-serif;">
    
                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <h2 style="color: #4CAF50;">A New Forex Signal has been updated </h2>
                        </div>
    
                        <div style="padding: 20px;">
                            <p>Here is your Contract details:</p>
                            
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li>Action: <strong> ${req.body.action}</strong></li>
                                <li>Currency: <strong>${req.body.currency}</strong></li> 
                                <li>Price: <strong>$ ${req.body.price}</strong></li> 
                                <li>Stop Loss: <strong>$ ${req.body.stopLoss}</strong></li>
                                <li>Take Profit: <strong>$ ${req.body.takeProfit}</strong></li>
                                <li>Date: <strong> ${formattedDate}</strong></li>
                                <li>Proof?: <strong>  <a href="#">Login and view it </a></strong></li>
                                
                            </ul>
                        </div>
    
                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <p style="color: #888;">Thank you for choosing FX AI!</p>
                        </div>
    
                    </body>
                    </html>
                `;
    
    
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                port: 456,
                secure: true,
                auth:{
                    user: "teamdevelopers72@gmail.com",
                    pass:"tpqe yuyw rvnt cxmi"
                }
            });
    
            const mailOptions = {
                from: 'teamdevelopers72@gmail.com',
                to: userEmails,
                subject: subject,
                html: emailTemplate,
            };
    
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending email notification:', error);
                } else {
                    console.log('Email notification sent:', info.response);
                }
            });
        }

        const proof = req.file ? req.file.filename : undefined;
        console.log(proof)
        const { action, currency, price, stopLoss, takeProfit } = req.body;
        const userId = req.user._id
    
        // Check if the user making the request is an admin
        const user = await User.findById(userId);
        if (!user || user.admin=== false) {
          return res.status(403).send('Unauthorized: Only admins can publish signals!');
        }
        const currentDate = new Date();
        const options = {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false // Set to true for 12-hour format
        };

        const formattedDate = currentDate.toLocaleString('en-US', options);
        
        if (proof) {
            const newSignal1 = new ForexSignal({
                action,
                currency,
                price,
                stopLoss,
                takeProfit,
                proof,
                updatedTime:formattedDate
              });

              console.log('newSignal1' , newSignal1)
              await newSignal1.save();
              sendEmialConfirmation()
              res.redirect('/admin');
          }else{
            const newSignal = new ForexSignal({
                action,
                currency,
                price,
                stopLoss,
                takeProfit,
                updatedTime: formattedDate
              });
          
              await newSignal.save();
              sendEmialConfirmation()
              res.redirect('/admin');
          }
      
        
      } catch (error) {
        res.status(500).send('Error saving signal!');
      }
    
    
})

app.post('/paypal', ensureAuthenticated, (req, res) => {
    // Parse the amount from the request body
    

     amount = parseFloat(req.body.amount);
     console.log(amount, typeof amount)

    // Check if the amount is a valid number
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).send('Invalid amount');
    }

    // Construct the amount object
     totalAmount = {
        currency: 'USD',
        total: amount.toFixed(2) // Format total as a string with two decimal places
    };

    // Construct the payment request
    const paymentRequest = {
        intent: 'sale',
        payer: {
            payment_method: 'paypal'
        },
        redirect_urls: {
            return_url: 'http://localhost:3000/payment_success',
            cancel_url: 'http://localhost:3000/payment_error'
        },
        transactions: [{
            item_list: {
                items: [{
                    name: 'Subscription',
                    sku: 'Subscription',
                    price: totalAmount.total,
                    currency: totalAmount.currency,
                    quantity: 1
                }]
            },
            amount: totalAmount,
            description: 'Buying Subscription'
        }]
    };
    console.log('Passed payment request')
    
    // Create the payment
    paypal.payment.create(paymentRequest, (error, payment) => {

        if (error) {
            console.error('Error occurred while creating payment:', error);
            return res.status(500).send('Internal Server Error');
        }

        // Redirect to PayPal approval URL
        const approvalUrl = payment.links.find(link => link.rel === 'approval_url');

        if (!approvalUrl) {
            console.error('Approval URL not found in the PayPal response.');
            return res.status(500).send('Internal Server Error');
        }
        console.log('Payment created sucessfully')
        res.redirect(approvalUrl.href);
    });
});

app.post('/bitcoin',ensureAuthenticated,(req,res)=>{
    const { amount } = req.body;

    // You now have the 'amount' value from the client.
    console.log('Received amount:', amount);
        res.send('ok,bitcoin')
})
app.post('/profile', upload.single('profile-img'), (req, res) => {
    const { name, username } = req.body;
  
    const profile_img = req.file ? req.file.filename : undefined; 
    // Find the user by their ID
    User.findById(req.user._id, (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Internal Server Error');
      }
  
      if (!user) {
        return res.status(404).send('User not found');
      }
  
      // Update the user's profile data
      user.name = name;
      user.username = username;
  
      if (profile_img) {
        // Update the user's profile image if a new one was uploaded
        user.profileImage = profile_img;
      }
      // Save the updated user data
      user.save((saveErr) => {
        if (saveErr) {
          console.error(saveErr);
          return res.status(500).send('Failed to update profile');
        }
  
        // Redirect to the user's profile page or another appropriate location
        res.redirect('/dash');
      });
    });
  });
  
app.post('/contact',(req,res)=>{

     // Create and send the email notification
     const senderEmail = req.user.name
     const message = req.body.message
     const emailTemplate = `
                     <!DOCTYPE html>
                     <html lang="en">
                     <head>
                         <meta charset="UTF-8">
                         <meta name="viewport" content="width=device-width, initial-scale=1.0">
                         <title>Someone wants to get in topuch with you </title>
                     </head>
                     <body style="font-family: Arial, sans-serif;">
 
                         <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                             <h2 style="color: #4CAF50;">${req.user.username} needs some more information about your services!</h2>
                         </div>
 
                         <div style="padding: 20px;">
                             <p><strong>${senderEmail}</strong> said: <strong> ${message}</strong></p>
                             
                             
                         </div>
 
                         <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                             <p style="color: #888;">Thank you </p>
                         </div>
 
                     </body>
                     </html>
                 `;

     //Create a transporter object using your Gmail credentials
     const transporter = nodemailer.createTransport({
        service:'gmail',
        port:456,
        secure:true,
        auth:{
            user: "teamdevelopers72@gmail.com",
            pass:"tpqe yuyw rvnt cxmi"
        }
    })
    
    const mailOptions = {
      from: 'darkunlocks1@gmail.com',
      to: 'dopegang004@gmail.com', 
      subject: 'A User wants to get in touch',
      html:emailTemplate
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email notification:', error);
      } else {
        console.log('Email notification sent:', info.response);
      }
    });
    res.redirect('/dash')
})
app.post('/register',(req,res)=>{

    const { username, password, name } = req.body;

    // Create a new user object with name, username, and password
    const newUser = new User({ username, name });

    User.register(newUser, password, (err, user) => {
        if (err) {
            console.log(err);
            res.redirect('/');
            
        } else {
            
            passport.authenticate('local')(req, res, () => {
                res.redirect('/dash');
                
            });
        }
    });
})

// Log in and dashboard access logic
app.post('/login', (req, res) => {
    const user = new User({
        username: req.body.username,
        password: req.body.password,
    });

    req.login(user, (err) => {
        if (err) {
            console.log(err);
            return res.redirect('/login');
        }

        passport.authenticate('local')(req, res, () => {
            // Check if the user's contract has expired
            if (req.user.contract !== 'false' && req.user.contractExpiration && Date.now() >= req.user.contractExpiration) {
                function sendEmialConfirmation(){

                    // Send a confirmation email to the user
                    const senderEmail = req.user.username;
                    
                    const subject = 'Contract Cancelation';
            
                    const emailTemplate = `
                            <!DOCTYPE html>
                            <html lang="en">
                            <head>
                                <meta charset="UTF-8">
                                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                <title>Contract Expiring</title>
                            </head>
                            <body style="font-family: Arial, sans-serif;">
            
                                <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                                    <h2 style="color: red;">Your Contract has Expired</h2>
                                </div>
            
                                <div style="padding: 20px;">
                                    <p>Here is your Contract details:</p>
                                    
                                    <ul style="list-style-type: none; padding: 0; margin: 0;">
                                        <li>User: <strong>${senderEmail}</strong></li>
                                        <li>Contract: <strong>${user.contract}</strong></li> 
                                        <li>Expiring at: <strong>${user.contractExpiration || Date.now()}</strong></li> 
                                    
                                        
                                    </ul>
                                </div>
            
                                <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                                    <p style="color: #888;">Thank you for choosing FX AI!</p>
                                </div>
            
                            </body>
                            </html>
                        `;
            
            
                    const transporter = nodemailer.createTransport({
                        service: 'gmail',
                        port: 456,
                        secure: true,
                        auth:{
                            user: "teamdevelopers72@gmail.com",
                            pass:"tpqe yuyw rvnt cxmi"
                        }
                    });
            
                    const mailOptions = {
                        from: 'teamdevelopers72@gmail.com',
                        to: senderEmail,
                        subject: subject,
                        html: emailTemplate,
                    };
            
                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error('Error sending email notification:', error);
                        } else {
                            console.log('Email notification sent:', info.response);
                        }
                    });
                }
                // Contract has expired, reset to 'false'
                req.user.contract = 'false';
                req.user.onlineClasses = false
                req.user.save((error) => {
                    if (error) {
                        console.error('Error resetting user contract:', error);
                    } else {
                        console.log('User contract reset successfully:', req.user);
                        sendEmialConfirmation()
                    }
                });
            }

            // Continue with the dashboard access logic
            res.redirect('/dash');
        });
    });
});


app.listen(PORT,()=>{
    console.log(`Server is running on port ${PORT}`)
})