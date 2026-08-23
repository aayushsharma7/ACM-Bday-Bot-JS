import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { getSettings } from "../models/settings.model.js";

// Same palette used in index.js / verify.js, kept local to this file so
// nothing else needs to be touched to support it.
const COLORS = {
    ERROR: 0xED4245,
    SUCCESS: 0x57F287,
    WARNING: 0xFEE75C,
};

function buildEmbed({ title, description, color }) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: 'Verification System' })
        .setTimestamp();
}

export default {
    data: new SlashCommandBuilder()
        .setName('togglecounter')
        .setDescription('Turn the branch verification counter on or off')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        // Guard: must be used inside a server, not a DM
        if (!interaction.guild) {
            return interaction.reply({
                embeds: [buildEmbed({
                    title: 'Server Only',
                    description: 'This command has to be used inside the server, not in DMs.',
                    color: COLORS.ERROR,
                })],
                ephemeral: true,
            });
        }

        try {
            const settings = await getSettings();
            settings.branchCounterEnabled = !settings.branchCounterEnabled;
            await settings.save();

            const isOn = settings.branchCounterEnabled;

            return interaction.reply({
                embeds: [buildEmbed({
                    title: 'Branch Counter Updated',
                    description: `The branch counter is now **${isOn ? 'ON' : 'OFF'}**.\n\n${
                        isOn
                            ? 'New verifications will update the counter and #stats.'
                            : "New verifications won't be counted — useful while testing join/leave flows."
                    }`,
                    color: isOn ? COLORS.SUCCESS : COLORS.WARNING,
                })],
                ephemeral: true,
            });
        } catch (err) {
            console.error('Failed to toggle branch counter:', err);
            return interaction.reply({
                embeds: [buildEmbed({
                    title: 'Something Went Wrong',
                    description: "Couldn't update the counter setting. Please try again.",
                    color: COLORS.ERROR,
                })],
                ephemeral: true,
            });
        }
    }
};