import mongoose from "mongoose";
import 'dotenv/config';
import { Client, Events, GatewayIntentBits, EmbedBuilder } from "discord.js"; // CHANGED: added EmbedBuilder
import crypto from "crypto"; // NEW: for hashing OTPs
import setbday from "./commands/setbday.js";
import updatebday from "./commands/updatebday.js";
import checkbday from "./commands/checkbday.js";
import deletebday from "./commands/deletebday.js";
import ping from "./commands/ping.js";
import { Bday } from "./models/bday.model.js";
import cron from 'node-cron';
import upcoming from "./commands/upcoming.js";
import help from "./commands/help.js";
import { Partials, ChannelType } from "discord.js"; // Updated to include Partials & ChannelType
import nodemailer from "nodemailer";
import { Verify } from "./models/verify.model.js";
import verify from "./commands/verify.js";
import { BranchStat } from "./models/branchstat.model.js"; // NEW: per-branch verification counts
import { getSettings } from "./models/settings.model.js"; // NEW: counter toggle + stats message tracking
import togglecounter from "./commands/togglecounter.js"; // NEW: admin toggle command
const connectDB = async () => {
    try {
        await mongoose.connect(`${process.env.MONGO_URI}`);
        console.log("DB Connected Successfully");
    } catch (error) {
        console.error("CRITICAL ERROR: Failed to connect to DB", error.message);
        // If DB fails, the bot shouldn't even try to start, otherwise commands will crash
        process.exit(1); 
    }
}

connectDB();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages, // NEW: Needed to send DMs
        GatewayIntentBits.MessageContent  // NEW: Needed to read OTP replies in DMs
    ],
    partials: [Partials.Channel, Partials.Message] // NEW: Needed to receive DMs from users not cached
});

client.once(Events.ClientReady, (c) => {
    console.log(`Bot is logged in as ${c.user.tag}`);
});

// The lock variable to prevent Hidencloud from spamming missed crons
let lastRunDate = null;

cron.schedule('1 0 * * *', async () => {
    try {
        const rawServerTime = new Date();
        const istTimeString = rawServerTime.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        const today = new Date(istTimeString);
        
        const currentMonthNum = today.getMonth() + 1;
        const currentDayNum = today.getDate();
        
        // BULLETPROOF DATE STRING: Manually format to "YYYY-MM-DD"
        // This prevents server locale changes from breaking your lock
        const currentDateString = `${today.getFullYear()}-${currentMonthNum}-${currentDayNum}`;
        
        if (lastRunDate === currentDateString) {
            console.log(`Cron prevented from duplicate run for date: ${currentDateString}. Skipping.`);
            return; 
        }
        
        // Lock the cron for today
        lastRunDate = currentDateString;

        console.log(`\n=== CRON TRIGGERED ===`);
        console.log(`Locked for Date: ${currentDateString}`);
        console.log(`Translated IST Time: ${today.toString()}`);
        console.log(`======================\n`);

        const currentMonthPadded = String(currentMonthNum).padStart(2, '0');
        const currentMonthPlain = String(currentMonthNum);
        
        const daysToSearch = [
            currentDayNum, 
            String(currentDayNum).padStart(2, '0'), 
            String(currentDayNum)
        ];

        // Leap year logic for Feb 28th
        const isLeapYear = (today.getFullYear() % 4 === 0 && today.getFullYear() % 100 !== 0) || (today.getFullYear() % 400 === 0);
        if (!isLeapYear && currentMonthNum === 2 && currentDayNum === 28) {
            daysToSearch.push(29, "29");
        }

        const todayBdays = await Bday.find({
            month: { $in: [currentMonthNum, currentMonthPadded, currentMonthPlain] },
            day: { $in: daysToSearch }
        });

        if (todayBdays.length > 0) {
            try {
                const channel = await client.channels.fetch('1032522552804909114');
                if (channel) {
                    // Extract unique user IDs using a Set to prevent duplicates if DB has multiple entries for one user
                    const uniqueUserIds = [...new Set(todayBdays.map(user => user.userId))];
                    const wishArray = uniqueUserIds.map(id => `<@${id}>`);
                    
                    let wishString = `🎂🎉 **Happy Birthday** ${wishArray.join(', ')}!`;
                    
                    if (wishString.length > 2000) {
                        wishString = `🎂🎉 **Happy Birthday** to all our wonderful members celebrating today!`;
                    }

                    await channel.send(wishString);
                    console.log(`Successfully wished ${uniqueUserIds.length} users.`);
                }
            } catch (discordError) {
                console.error("Discord Channel Fetch/Send Error:", discordError);
            }
        } else {
            console.log("No birthdays today.");
        }
    } catch (dbError) {
        console.error("Database Cron Error:", dbError);
    }
}, { timezone: "Asia/Kolkata" });


client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    // Command Router
    try {
        if (interaction.commandName === 'setbday') {
            await setbday.execute(interaction);
        } else if (interaction.commandName === 'updatebday') {
            await updatebday.execute(interaction);
        } else if (interaction.commandName === 'checkbday') {
            await checkbday.execute(interaction);
        } else if (interaction.commandName === 'deletebday') {
            await deletebday.execute(interaction);
        } else if (interaction.commandName === 'ping') {
            await ping.execute(interaction);
        } else if (interaction.commandName === 'upcoming') {
            await upcoming.execute(interaction);
        } else if (interaction.commandName === 'help') {
            await help.execute(interaction);
        } else if (interaction.commandName === 'verify') {
            await verify.execute(interaction);
        } else if (interaction.commandName === 'togglecounter') { // NEW
            await togglecounter.execute(interaction);
        }
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        
        // Ensure we reply to the interaction even if the command crashes, so it doesn't show "Application did not respond"
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
        }
    }
});

// ==========================================
// EMAIL VERIFICATION SYSTEM
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ── config ──────────────────────────────────────────────
const OTP_EXPIRY_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@pec\.edu\.in$/; // stricter than endsWith: blocks "@pec.edu.in" with no name part
const JOIN_LOG_CHANNEL_ID = '1032522552804909109'; // verification logs go here
const STATS_CHANNEL_ID = '1541058656752373760'; // NEW: branch counter leaderboard goes here

const COLORS = {
    ERROR: 0xED4245,
    SUCCESS: 0x57F287,
    INFO: 0x5865F2,
    WARNING: 0xFEE75C,
};

// Friendlier text for common Discord API error codes
const DISCORD_ERROR_HINTS = {
    50013: "I don't have permission to manage roles — check my role's position and permissions.",
    50001: "I'm missing access to perform that action in this server.",
};

// CHANGED: added `author` (avatar + name, for the log-style embeds) and
// `footerText` (defaults to the old static text so every existing call site
// that doesn't pass it keeps behaving exactly as before)
function buildEmbed({ title, description, color = COLORS.INFO, fields = [], author = null, footerText = 'Verification System' }) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: footerText })
        .setTimestamp();
    if (fields.length) embed.addFields(fields);
    if (author) embed.setAuthor({ name: author.name, iconURL: author.iconURL }); // NEW
    return embed;
}

// sends a log embed to #join-log. Channel is fetched once and cached;
// if the fetch/send ever fails, the cache is cleared so the next call retries.
let logChannelCache = null;
async function sendLog(embed) {
    try {
        if (!logChannelCache) {
            logChannelCache = await client.channels.fetch(JOIN_LOG_CHANNEL_ID);
        }
        if (logChannelCache) await logChannelCache.send({ embeds: [embed] });
    } catch (err) {
        console.error('Failed to send verification log:', err);
        logChannelCache = null;
    }
}

// ==========================================
// BRANCH COUNTER SYSTEM
// ==========================================
// Maps a lowercase branch code (parsed from the email) to its full name for
// display. A code with no entry here still works fine — it just renders as
// the raw uppercased code with no expansion.
// const BRANCH_NAMES = {
//     cse: 'Computer Science & Engineering',
//     ece: 'Electronics & Communication Engineering',
//     ee: 'Electrical Engineering',
//     me: 'Mechanical Engineering',
//     ce: 'Civil Engineering',
//     it: 'Information Technology',
//     pie: 'Production & Industrial Engineering',
//     mme: 'Materials & Metallurgical Engineering',
//     ae: 'Aerospace Engineering',
//     aero: 'Aerospace Engineering',
//     unknown: 'Unrecognized / Other',
// };

// College email local-parts look like "rahulsharma.bt23ece" — a 2-digit
// admission year immediately followed by the branch code (letters only, any
// length) right before the "@". Returns the lowercase branch code, or null
// if that shape isn't found in the local part.
function parseBranch(email) {
    const localPart = email.split('@')[0];
    const match = localPart.match(/\d{2}([a-zA-Z]+)$/);
    return match ? match[1].toLowerCase() : null;
}

// Atomic upsert-increment — safe even if two verifications land at the exact
// same instant, since Mongo does the +1 server-side rather than us
// read-modify-writing a count in JS.
async function incrementBranchCount(branch) {
    await BranchStat.findOneAndUpdate(
        { branch },
        { $inc: { count: 1 } },
        { upsert: true }
    );
}

function formatBranchLabel(branch) {
    
    return branch
}

// Rebuilds and reposts the #stats leaderboard, deleting the previous message
// first so the channel only ever holds one, current snapshot.
// Note: if two verifications finish at the exact same moment there's a small
// race window (the second repost could delete the message the first one just
// posted) — acceptable at this scale, not worth a distributed lock for a
// college server bot.
async function postStatsEmbed() {
    try {
        const stats = await BranchStat.find().sort({ count: -1 });
        const total = stats.reduce((sum, s) => sum + s.count, 0);

        const lines = stats.length
            ? stats.map(s => `**${formatBranchLabel(s.branch)}** — ${s.count}`).join('\n')
            : 'No verifications recorded yet.';

        const embed = new EmbedBuilder()
            .setTitle('Verified Members by Branch')
            .setDescription(`**Total Verified:** ${total}\n\n${lines}`)
            .setColor(COLORS.INFO)
            .setFooter({ text: 'Branch Counter' })
            .setTimestamp();

        const channel = await client.channels.fetch(STATS_CHANNEL_ID);
        if (!channel) return;

        const settings = await getSettings();

        if (settings.statsMessageId) {
            const oldMessage = await channel.messages.fetch(settings.statsMessageId).catch(() => null);
            if (oldMessage) await oldMessage.delete().catch(() => {});
        }

        const newMessage = await channel.send({ embeds: [embed] });
        settings.statsMessageId = newMessage.id;
        await settings.save();
    } catch (err) {
        console.error('Failed to update the branch stats embed:', err);
    }
}

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashOtp(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
}

// ms left in a cooldown window; <= 0 means the cooldown has passed
function msRemaining(from, seconds) {
    return seconds * 1000 - (Date.now() - from.getTime());
}

async function sendOtpEmail(to, otp) {
    await transporter.sendMail({
        from: `"Server Verification" <${process.env.EMAIL_USER}>`,
        to,
        subject: 'Discord College Verification Code',
        text: `Your 6-digit verification code is: ${otp}\n\nThis code will expire in ${OTP_EXPIRY_MINUTES} minutes.`,
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
                <h2 style="color:#5865F2;">Server Verification</h2>
                <p>Your 6-digit verification code is:</p>
                <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
                <p>This code expires in <b>${OTP_EXPIRY_MINUTES} minutes</b>.</p>
                <p style="color:#888; font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
            </div>
        `
    });
}

// Trigger 1: When a user joins the server
client.on(Events.GuildMemberAdd, async (member) => {
    // 🛑 Ignore users joining other servers
    if (member.guild.id !== process.env.VERIFY_GUILD_ID) return;

    try {
        // Clear any old attempts and start fresh in the DB
        await Verify.findOneAndDelete({ userId: member.id });
        
        await Verify.create({
            userId: member.id,
            guildId: member.guild.id,
            step: 'AWAITING_EMAIL'
        });

        // Restrict access immediately by giving them the unverified role
        if (process.env.UNVERIFIED_ROLE_ID) {
            await member.roles.add(process.env.UNVERIFIED_ROLE_ID).catch(err => {
                console.error("Could not add unverified role:", err);
            });
        }

        await member.send({
            embeds: [buildEmbed({
                title: `Welcome to ${member.guild.name}!`,
                description: 'To gain full access to the server, please verify your identity.\n\n**Reply to this message with your college email address** (e.g. `student@pec.edu.in`).',
                color: COLORS.INFO,
            })]
        });
    } catch (error) {
        console.error(`Failed to DM new member ${member.user.tag}. DMs might be disabled.`, error);
        // CHANGED: professional log embed — author block instead of emoji title, ID moved to footer
        await sendLog(buildEmbed({
            title: 'Welcome DM Failed',
            description: 'Could not DM this member on join — they likely have server DMs disabled, so verification never started.',
            color: COLORS.ERROR,
            author: { name: member.user.tag, iconURL: member.user.displayAvatarURL() },
            fields: [
                { name: 'Member', value: `<@${member.id}>` },
            ],
            footerText: `ID: ${member.id}`,
        }));
    }
});

// Trigger 2: When a user replies in DMs
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || message.channel.type !== ChannelType.DM) return;

    const session = await Verify.findOne({ userId: message.author.id });
    if (!session) return; // User isn't in a verification flow

    const userInput = message.content.trim();

    try {
        // Show "typing..." immediately so it doesn't look like the bot is stuck
        await message.channel.sendTyping().catch(() => {});

        // Cancel / restart works at any step
        if (['cancel', 'stop', 'restart'].includes(userInput.toLowerCase())) {
            await Verify.findOneAndDelete({ userId: message.author.id });
            return message.reply({
                embeds: [buildEmbed({
                    title: '🚫 Verification Cancelled',
                    description: "No worries — rejoin the server or contact an admin whenever you're ready to try again. Also try /verify in any channel in the server",
                    color: COLORS.WARNING,
                })]
            });
        }

        // STEP A: Handle Email Entry
        if (session.step === 'AWAITING_EMAIL') {
            const email = userInput.toLowerCase();

            // Strict domain + format validation
            if (!EMAIL_REGEX.test(email)) {
                return message.reply({
                    embeds: [buildEmbed({
                        title: '❌ Invalid Email',
                        description: 'Please enter a valid college email ending with `@pec.edu.in`.\n\n*Example:* `yourname.cs21@pec.edu.in`',
                        color: COLORS.ERROR,
                    })]
                });
            }

            // Cooldown so a typo-prone user can't spam the mail server
            if (session.lastEmailSentAt && msRemaining(session.lastEmailSentAt, RESEND_COOLDOWN_SECONDS) > 0) {
                const wait = Math.ceil(msRemaining(session.lastEmailSentAt, RESEND_COOLDOWN_SECONDS) / 1000);
                return message.reply({
                    embeds: [buildEmbed({
                        title: '⏳ Slow Down',
                        description: `Please wait **${wait}s** before requesting another code.`,
                        color: COLORS.WARNING,
                    })]
                });
            }

            const otp = generateOtp();

            // Refresh the typing indicator right before the slow network call
            await message.channel.sendTyping().catch(() => {});

            try {
                await sendOtpEmail(email, otp);

                // Update DB session to wait for OTP
                session.email = email;
                session.otpHash = hashOtp(otp);        // never store the raw OTP
                session.otpAttempts = 0;
                session.step = 'AWAITING_OTP';
                session.lastEmailSentAt = new Date();
                session.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
                await session.save();

                return message.reply({
                    embeds: [buildEmbed({
                        title: '📩 Code Sent',
                        description: `A 6-digit code was sent to \`${email}\`.\n\n**Reply here with the code** within **${OTP_EXPIRY_MINUTES} minutes**.\n\n**Try checking the spam mail if you are unable to find it**.\n\nType \`resend\` for a new code, or \`cancel\` to stop.`,
                        color: COLORS.SUCCESS,
                    })]
                });
            } catch (err) {
                console.error("Email send failed:", err);
                // CHANGED: professional log embed
                await sendLog(buildEmbed({
                    title: 'Email Delivery Failed',
                    description: 'Failed to send the initial verification code.',
                    color: COLORS.ERROR,
                    author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
                    fields: [
                        { name: 'Member', value: `<@${message.author.id}>` },
                        { name: 'Attempted Email', value: `\`${email}\`` },
                        { name: 'Error', value: `\`${(err.message || 'Unknown error').slice(0, 200)}\`` },
                    ],
                    footerText: `ID: ${message.author.id}`,
                }));
                return message.reply({
                    embeds: [buildEmbed({
                        title: "⚠️ Couldn't Send Email",
                        description: 'Something went wrong sending the verification email. Double-check the address and try again in a moment.',
                        color: COLORS.ERROR,
                    })]
                });
            }
        }

        // STEP B: Handle OTP Entry
        if (session.step === 'AWAITING_OTP') {
            // Precise 15-min expiry check (the DB's 30m TTL is just the outer safety net)
            if (session.otpExpiresAt && session.otpExpiresAt < new Date()) {
                await Verify.findOneAndDelete({ userId: message.author.id });
                return message.reply({
                    embeds: [buildEmbed({
                        title: '⌛ Code Expired',
                        description: 'That code has expired. Please rejoin the server or contact an admin to restart verification.',
                        color: COLORS.WARNING,
                    })]
                });
            }

            // Let the user request a fresh code without retyping their email
            if (userInput.toLowerCase() === 'resend') {
                if (session.lastEmailSentAt && msRemaining(session.lastEmailSentAt, RESEND_COOLDOWN_SECONDS) > 0) {
                    const wait = Math.ceil(msRemaining(session.lastEmailSentAt, RESEND_COOLDOWN_SECONDS) / 1000);
                    return message.reply({
                        embeds: [buildEmbed({
                            title: '⏳ Slow Down',
                            description: `Please wait **${wait}s** before requesting another code.`,
                            color: COLORS.WARNING,
                        })]
                    });
                }

                const otp = generateOtp();
                // Refresh the typing indicator right before the slow network call
                await message.channel.sendTyping().catch(() => {});

                try {
                    await sendOtpEmail(session.email, otp);
                    session.otpHash = hashOtp(otp);
                    session.otpAttempts = 0;
                    session.lastEmailSentAt = new Date();
                    session.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
                    await session.save();
                    return message.reply({
                        embeds: [buildEmbed({
                            title: '📩 New Code Sent',
                            description: `A fresh code was sent to \`${session.email}\`.`,
                            color: COLORS.SUCCESS,
                        })]
                    });
                } catch (err) {
                    console.error("Resend failed:", err);
                    // CHANGED: professional log embed
                    await sendLog(buildEmbed({
                        title: 'Email Resend Failed',
                        description: 'Failed to resend the verification code.',
                        color: COLORS.ERROR,
                        author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
                        fields: [
                            { name: 'Member', value: `<@${message.author.id}>` },
                            { name: 'Email', value: `\`${session.email}\`` },
                            { name: 'Error', value: `\`${(err.message || 'Unknown error').slice(0, 200)}\`` },
                        ],
                        footerText: `ID: ${message.author.id}`,
                    }));
                    return message.reply({
                        embeds: [buildEmbed({
                            title: "⚠️ Couldn't Resend",
                            description: 'Failed to resend the code. Please try again shortly.',
                            color: COLORS.ERROR,
                        })]
                    });
                }
            }

            // Reject anything that isn't a clean 6-digit code before comparing
            if (!/^\d{6}$/.test(userInput)) {
                return message.reply({
                    embeds: [buildEmbed({
                        title: '❌ Invalid Format',
                        description: 'Please enter the **6-digit numeric code** exactly as received.\nType `resend` for a new code, or `cancel` to stop.',
                        color: COLORS.ERROR,
                    })]
                });
            }

            if (hashOtp(userInput) !== session.otpHash) {
                session.otpAttempts += 1;

                if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
                    await Verify.findOneAndDelete({ userId: message.author.id });
                    // CHANGED: professional log embed
                    await sendLog(buildEmbed({
                        title: 'Verification Lockout',
                        description: 'Exceeded the maximum OTP attempts and was locked out.',
                        color: COLORS.ERROR,
                        author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
                        fields: [
                            { name: 'Member', value: `<@${message.author.id}>` },
                            { name: 'Email', value: session.email ? `\`${session.email}\`` : 'N/A' },
                        ],
                        footerText: `ID: ${message.author.id}`,
                    }));
                    return message.reply({
                        embeds: [buildEmbed({
                            title: '🔒 Too Many Attempts',
                            description: "You've hit the maximum number of tries. Please rejoin the server or contact an admin to restart verification.",
                            color: COLORS.ERROR,
                        })]
                    });
                }

                await session.save();
                const remaining = MAX_OTP_ATTEMPTS - session.otpAttempts;
                return message.reply({
                    embeds: [buildEmbed({
                        title: '❌ Incorrect Code',
                        description: `That code doesn't match. **${remaining}** attempt(s) left.\nType \`resend\` for a new code, or \`cancel\` to stop.`,
                        color: COLORS.ERROR,
                    })]
                });
            }

            // OTP is correct — assign roles
            if (!process.env.VERIFIED_ROLE_ID) {
                console.error('VERIFIED_ROLE_ID is not set in environment variables.');
                // CHANGED: professional log embed
                await sendLog(buildEmbed({
                    title: 'Configuration Error',
                    description: `Completed OTP verification, but \`VERIFIED_ROLE_ID\` is not set. No role could be assigned.`,
                    color: COLORS.ERROR,
                    author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
                    fields: [
                        { name: 'Member', value: `<@${message.author.id}>` },
                        { name: 'Email', value: `\`${session.email}\`` },
                    ],
                    footerText: `ID: ${message.author.id}`,
                }));
                return message.reply({
                    embeds: [buildEmbed({
                        title: '⚠️ Configuration Error',
                        description: "Verification role isn't configured yet. Please contact a server admin.",
                        color: COLORS.ERROR,
                    })]
                });
            }

            try {
                // Refresh the typing indicator before the guild/member fetch + role calls
                await message.channel.sendTyping().catch(() => {});

                // OTP is correct, fetch the guild and member
                const guild = await client.guilds.fetch(session.guildId);
                const member = await guild.members.fetch(message.author.id);

                // 1. Assign the verified role
                await member.roles.add(process.env.VERIFIED_ROLE_ID);

                // 2. Remove the unverified role
                if (process.env.UNVERIFIED_ROLE_ID) {
                    await member.roles.remove(process.env.UNVERIFIED_ROLE_ID).catch(err => {
                        console.error("Could not remove unverified role:", err);
                    });
                }

                const verifiedEmail = session.email; // captured before session is deleted, for the log/counter

                // Cleanup the DB record
                await Verify.findOneAndDelete({ userId: message.author.id });

                await message.reply({
                    embeds: [buildEmbed({
                        title: 'Verification Successful!',
                        description: `You now have full access to **${guild.name}**.`,
                        color: COLORS.SUCCESS,
                    })]
                });

                // NEW: branch counter — parse the branch from the verified email,
                // fall back to an "unknown" bucket if the shape doesn't match.
                // The whole counter (increment + #stats repost) is skipped while
                // toggled off via /togglecounter, but the branch is still shown
                // in the log either way so admins can see what *would* have
                // been counted.
                const branchCode = parseBranch(verifiedEmail);
                const bucket = branchCode || 'unknown';
                const settings = await getSettings();

                if (settings.branchCounterEnabled) {
                    await incrementBranchCount(bucket);
                    await postStatsEmbed();
                }

                await sendLog(buildEmbed({
                    title: branchCode ? 'Member Verified' : 'Member Verified — Branch Unrecognized',
                    description: branchCode
                        ? 'Successfully verified and granted access.'
                        : 'Successfully verified and granted access, but the branch code could not be parsed from the email — counted under Unknown.',
                    color: branchCode ? COLORS.SUCCESS : COLORS.WARNING,
                    author: { name: member.user.tag, iconURL: member.user.displayAvatarURL() },
                    fields: [
                        { name: 'Member', value: `<@${member.id}>` },
                        { name: 'Email', value: `\`${verifiedEmail}\`` },
                        ...(settings.branchCounterEnabled ? [] : [{ name: 'Counter', value: 'Not counted — branch counter is currently disabled' }]),
                    ],
                    footerText: `ID: ${member.id}`,
                }));
            } catch (err) {
                console.error("Role Assignment Error:", err);

                // Member left the server mid-flow
                if (err.code === 10007 || err.code === 10013) {
                    await Verify.findOneAndDelete({ userId: message.author.id });
                    return message.reply({
                        embeds: [buildEmbed({
                            title: '⚠️ Not In Server',
                            description: 'You appear to have left the server. Please rejoin to restart verification.',
                            color: COLORS.ERROR,
                        })]
                    });
                }

                const hint = DISCORD_ERROR_HINTS[err.code];
                // CHANGED: professional log embed
                await sendLog(buildEmbed({
                    title: 'Role Assignment Failed',
                    description: `Entered the correct code, but roles could not be updated.`,
                    color: COLORS.ERROR,
                    author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
                    fields: [
                        { name: 'Member', value: `<@${message.author.id}>` },
                        { name: 'Email', value: `\`${session.email}\`` },
                        { name: 'Error Code', value: `\`${err.code || 'Unknown'}\`` },
                    ],
                    footerText: `ID: ${message.author.id}`,
                }));
                // Deliberately NOT deleting the session here — the OTP was correct,
                // so the user can just message again once the role issue (e.g. bot
                // permissions) is fixed, instead of restarting from scratch.
                await message.reply({
                    embeds: [buildEmbed({
                        title: '⚠️ Role Assignment Failed',
                        description: `Code verified, but I couldn't update your roles.${hint ? `\n\n${hint}` : ''}\nPlease contact a server admin.`,
                        color: COLORS.ERROR,
                    })]
                });
            }
        }
    } catch (outerErr) {
        console.error('Unhandled verification error:', outerErr);
        // CHANGED: professional log embed
        sendLog(buildEmbed({
            title: 'Unexpected Verification Error',
            description: `An unhandled error occurred while processing a DM from this member.`,
            color: COLORS.ERROR,
            author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
            fields: [
                { name: 'Member', value: `<@${message.author.id}>` },
                { name: 'Error', value: `\`${(outerErr.message || 'Unknown error').slice(0, 200)}\`` },
            ],
            footerText: `ID: ${message.author.id}`,
        })).catch(() => {});
        message.reply({
            embeds: [buildEmbed({
                title: '⚠️ Unexpected Error',
                description: 'Something went wrong. Please try again, or contact a server admin if it persists.',
                color: COLORS.ERROR,
            })]
        }).catch(() => {});
    }
});

client.login(process.env.DISCORD_TOKEN);