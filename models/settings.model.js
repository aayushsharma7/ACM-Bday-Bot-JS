import mongoose from "mongoose";

// Singleton document (key is always "global") for bot-wide settings that need
// to survive restarts: whether the branch counter is currently updating, and
// the ID of the currently-posted #stats message so we know what to delete
// before posting a fresh one.
const settingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'global' },
    branchCounterEnabled: { type: Boolean, default: true },
    statsMessageId: { type: String, default: null }
});

export const Settings = mongoose.model("Settings", settingsSchema);

// Always returns the single settings doc, creating it on first use so
// nothing else has to worry about it not existing yet.
export async function getSettings() {
    let settings = await Settings.findOne({ key: 'global' });
    if (!settings) {
        settings = await Settings.create({ key: 'global' });
    }
    return settings;
}