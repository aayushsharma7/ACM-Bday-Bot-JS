import mongoose from "mongoose";

// One document per branch code (e.g. "ece", "cse", "unknown"). `count` is
// only ever touched through an atomic $inc (see incrementBranchCount in
// index.js), so concurrent verifications can never race and clobber it.
const branchStatSchema = new mongoose.Schema({
    branch: { type: String, required: true, unique: true }, // lowercase branch code
    count: { type: Number, default: 0 }
});

export const BranchStat = mongoose.model("BranchStat", branchStatSchema);