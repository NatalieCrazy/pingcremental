const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const pingMessages = require('./../helpers/pingMessage.js')
const database = require('./../helpers/database.js')
const { upgrades, rawUpgrades } = require('./../helpers/upgrades.js')
const { ownerId } = require('./../config.json');
const formatNumber = require('./../helpers/formatNumber.js')
const { getEmoji } = require('../helpers/emojis.js');
const awardBadge = require('../helpers/awardBadge.js');
const MAX_PING_OFFSET = 5

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('ping!')
        .setContexts(InteractionContextType.BotDM, InteractionContextType.Guild, InteractionContextType.PrivateChannel),
    async execute(interaction) {
        const again = new ButtonBuilder()
            .setCustomId('ping:again')
            .setLabel('ping again!')
            .setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder()
            .addComponents(again);

        let pingmessage = pingMessages(interaction.client.ws.ping, { user: interaction.user })

        await interaction.reply({
            content: `${pingmessage}`,
            components: [row]
        });
    },
    buttons: {
        "again": (async (interaction) => {
            await ping(interaction, false)
        }),
        "super": (async (interaction) => {
            await ping(interaction, true)
        }),
        "delete": (async interaction => {
            await interaction.update({ content: `(bye!)`, components: [] });
            await interaction.deleteReply(interaction.message);
        }),
        "unknown": (async interaction => {
            await interaction.reply({ content: "unknown ping occurs when the bot just restarted. either something has gone horribly wrong, or something was changed! maybe some new stuff was added, maybe a bug was fixed. you can check the [github](<https://github.com/MonkeysWithPie/pingcremental/>) if you're curious. if you wait a few seconds, the ping will come back to normal.", flags: MessageFlags.Ephemeral })
        })
    }
};

async function ping(interaction, isSuper = false) {
    // prevent pinging during dev mode
    const developmentMode = process.argv.includes('--dev') || process.argv.includes('-d');
    if (developmentMode && interaction.user.id !== ownerId) {
        return await interaction.update({
            content: "there's some important dev stuff going on! pings are disabled for now, but will (hopefully) be back shortly.",
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ping:again')
                    .setLabel('ping again!')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('ping:delete')
                    .setLabel('dang!')
                    .setStyle(ButtonStyle.Secondary))
            ],
        })
    }

    let againId = 'ping:again';
    const again = new ButtonBuilder()
        .setCustomId(againId)
        .setLabel('ping again!')
        .setStyle(ButtonStyle.Secondary);
    let row = new ActionRowBuilder();

    if (interaction.client.ws.ping === -1 && !developmentMode) { // bot just restarted
        row.addComponents(again, new ButtonBuilder()
            .setCustomId('ping:unknown')
            .setLabel('unknown ms?')
            .setStyle(ButtonStyle.Secondary));
        return await interaction.update({ // return early 
            content: `${pingMessages(interaction.client.ws.ping, { user: interaction.user })}`,
            components: [row]
        })
    }

    let ping = interaction.client.ws.ping;
    if (developmentMode) {
        ping = 6; // for testing purposes; prevents too much point gain & bypasses unknown ping
    }
    ping += Math.round(Math.random() * MAX_PING_OFFSET * 2) - MAX_PING_OFFSET; // randomize a bit since it only updates occasionally

    const [playerProfile, _created] = await database.Player.findOrCreate({ where: { userId: interaction.user.id } })
    let context = { // BIG LONG EVIL CONTEXT (will kill you if it gets the chance)
        // actual context
        user: interaction.user,
        ping: ping,
        isSuper: isSuper,

        // player profile bits
        score: playerProfile.score,
        clicks: playerProfile.clicks,
        totalClicks: playerProfile.totalClicks,
        pip: playerProfile.pip,
        removedUpgrades: playerProfile.removedUpgrades,
        missedBluePings: playerProfile.bluePingsMissed,

        // per-upgrade vars
        slumberClicks: playerProfile.slumberClicks,
        glimmerClicks: playerProfile.glimmerClicks,
        
        // updated vars
        spawnedSuper: false,
        rare: false,
        blue: 0,
        blueStrength: 1,
        specials: {},
        RNGmult: 1,
        blueCombo: 0,
    }

    let iterateUpgrades = {}
    for (const upgradeTypeList of [playerProfile.upgrades, playerProfile.prestigeUpgrades]) {
        if (!upgradeTypeList) continue;
        for (const [upg, lv] of Object.entries(upgradeTypeList)) iterateUpgrades[upg] = lv;
    }


    /* PRE-PTS CALCULATION */
    

    // prep a bunch of variables for the effects
    let currentEffects = {
        mults: [],
        exponents: [],
        blue: 0,
        blueStrength: 1,
        specials: {},
        bp: 0,
        RNGmult: 1,
        // add more if needed
    }
    let displays = {
        add: [],
        mult: [],
        exponents: [],
        extra: [],
        bp: [],
    }
    const pingFormat = playerProfile.settings.pingFormat || "expanded";
    if (pingFormat === "expanded") {
        displays.add.push(`${getEmoji('ping')} \`+${ping}\``);
    } else if (pingFormat === "compact") {
        displays.add.push(`${getEmoji('ping')}`);
    }
    let effect;
    let score = ping; // base score is ping


    for (const [upgradeId, level] of Object.entries(iterateUpgrades)) {
        effect = rawUpgrades[upgradeId].getEffect(level, context);
        if (effect.special) {
            for (const [special, value] of Object.entries(effect.special)) {
                currentEffects.specials[special] = value;
            }
        }
        if (effect.blue) { 
            currentEffects.blue += effect.blue; 
            context.blue = currentEffects.blue; 
        }
        if (effect.blueStrength) { 
            currentEffects.blueStrength += effect.blueStrength; 
            context.blueStrength = currentEffects.blueStrength; 
        }
        if (effect.RNGmult) { 
            currentEffects.RNGmult += effect.RNGmult; 
            context.RNGmult = currentEffects.RNGmult; 
        }
    }

    currentEffects.blue = Math.min(currentEffects.blue, 35 + (currentEffects.specials.blueCap || 0)); // cap blue at 35%

    if (isSuper) {
        let blueStrength = (currentEffects.blueStrength) * 15;
        currentEffects.mults.push(blueStrength);
        if (pingFormat === "expanded") {
            displays.mult.push(`${getEmoji('upgrade_blue')} __\`x${blueStrength.toFixed(2)}\`__`)
        } else if (pingFormat === "compact") {
            displays.mult.push(`${getEmoji('upgrade_blue')}`)
        }
    }
    if (Math.random() * 1000 < (currentEffects.blue * 10) && currentEffects.specials.blueping) {
        context.spawnedSuper = true;
        
        let combo = false;
        if (isSuper) {
            combo = 1;
            for (const messageButton of interaction.message.components[0].components) { // check every button in the first row
                if (messageButton.data.custom_id === 'ping:super') {
                    combo = (parseInt(messageButton.data.label.split('x')[1]) || 1) + 1; // get the current combo
                }
            }
        }

        if (combo && combo > playerProfile.highestBlueStreak) {
            playerProfile.highestBlueStreak = combo;
        }
        
        if (combo >= 10) { await awardBadge(interaction.user.id, 'blue stupor', interaction.client); }
        context.blueCombo = combo;
    }
    if ((Math.random() * 1000 < 1 * currentEffects.RNGmult)) {
        context.rare = true;
        await awardBadge(interaction.user.id, 'lucky', interaction.client);
    }
    
    context.specials = currentEffects.specials; // update context for later effects

    // add slumber clicks if offline for long enough
    if (currentEffects.specials.canGainSlumber && Date.now() - playerProfile.lastPing >= 1000 * 60 * (21 - playerProfile.upgrades.slumber)) {
        playerProfile.slumberClicks += Math.floor((Date.now() - playerProfile.lastPing) / (1000 * 60 * (21 - playerProfile.upgrades.slumber)));
        playerProfile.slumberClicks = Math.min(playerProfile.slumberClicks, Math.round((2 * 24 * 60) / (21 - playerProfile.upgrades.slumber))); // max of 2 days of slumber clicks
        playerProfile.slumberClicks = Math.max(playerProfile.slumberClicks, 0); // no negative slumber clicks
        context.slumberClicks = playerProfile.slumberClicks; // update context for later effects
    }

    
    /* PTS CALCULATION */

    
    for (const [upgradeId, level] of Object.entries(iterateUpgrades)) {
        const upgradeClass = rawUpgrades[upgradeId];
        effect = upgradeClass.getEffect(level,context);

        let effectString = upgradeClass.getDetails().emoji;

        // apply effects where appropriate
        if (effect.add && effect.add !== 0) {
            score += effect.add;
            effectString += ` \`${effect.add >= 0 ? "+" : ""}${formatNumber(effect.add)}\``
        }

        if (effect.multiply && effect.multiply !== 1) {
            currentEffects.mults.push(effect.multiply);

            // prevent floating point jank
            const formattedMultiplier = effect.multiply.toFixed(2)

            effectString += ` __\`x${formattedMultiplier}\`__`
        }

        if (effect.exponent && effect.exponent !== 1) {
            currentEffects.exponents.push(effect.exponent);
            effectString += ` **__\`^${effect.exponent.toFixed(2)}\`__**`
        }

        if (effect.special) { 
            for (const [special, value] of Object.entries(effect.special)) {
                if (!currentEffects.specials[special]) currentEffects.specials[special] = value;
            }
        }

        if (effect.bp) { 
            currentEffects.bp += effect.bp;
            effectString += ` \`+${effect.bp} bp\``
        }

        if (pingFormat === "compact" && effectString !== upgradeClass.getDetails().emoji) {
            effectString = `${upgradeClass.getDetails().emoji} `;
        }
        
        // bypasses compact mode
        if (effect.message) { effectString += ` ${effect.message}`; }
        
        if (pingFormat === "compact emojiless") {
            effectString = "";
        }

        // add to display
        if (effectString !== upgradeClass.getDetails().emoji && effectString !== "") {
            if (effect.add) {
                displays.add.push(effectString);
            } else if (effect.multiply) {
                displays.mult.push(effectString);
            } else if (effect.exponent) {
                displays.exponents.push(effectString);
            } else if (effect.bp) {
                displays.bp.push(effectString);
            } else {
                displays.extra.push(effectString);
            }
        }
    }

    if (pingFormat !== "expanded") {
        displays.add.push(`\`+${formatNumber(score)}\``);
        if (currentEffects.bp) {
            displays.bp.push(`\`+${formatNumber(currentEffects.bp)} bp\``);
        }
    }


    /* SPECIALS */


    if (currentEffects.specials.slumber) {
        playerProfile.slumberClicks += currentEffects.specials.slumber;
    }
    if (currentEffects.specials.glimmer) {
        playerProfile.glimmerClicks += currentEffects.specials.glimmer;
    }

    const rowComponents = [];
    // blue ping handling
    if (!currentEffects.specials.budge) {
        rowComponents.push(again);
    }
    // check if blue ping should trigger
    if (context.spawnedSuper) {
        playerProfile.bluePings += 1;
        const superPing = new ButtonBuilder()
            .setCustomId('ping:super')
            .setLabel(`blue ping!${isSuper ? ` x${context.blueCombo}` : ''}`)
            .setStyle(ButtonStyle.Primary);
        rowComponents.push(superPing);
    }
    if (currentEffects.specials.budge) {
        if (!currentEffects.specials.bully) rowComponents.push(again);
    }

    score = Math.max(score, 1); // prevent negative scores

    let totalMult = 1;
    // add mults at the end so they're actually effective
    for (const mult of currentEffects.mults) {
        score *= mult;
        totalMult *= mult;
    }

    if (totalMult > 1 && pingFormat !== "expanded") {
        displays.mult.push(`__\`x${totalMult.toFixed(2)}\`__`);
    }

    let totalExp = 1;
    for (const exponent of currentEffects.exponents) {
        score = Math.pow(score, exponent);
        totalExp *= exponent;
    }

    if (totalExp > 1 && pingFormat !== "expanded") {
        displays.exponents.push(`**__\`^${totalExp.toFixed(2)}\`__**`);
    }

    score = Math.round(score);
    context.score = score; // update context for later effects
    if (score === Infinity) score = 0; // prevent infinite score (and fuck you; you get nothing)
    
    let bpMax = ((playerProfile.upgrades.limit || 0) + 1) * 10000;
    bpMax += (playerProfile.prestigeUpgrades.storage || 0) * 2500;

    /* SAVE STATS */


    context.score += score; // update context for later effects
    const pingMessage = pingMessages(ping, context); // get the ping message

    // apply stats and save
    playerProfile.clicks += 1;
    playerProfile.totalClicks += 1;
    if (playerProfile.clicks > playerProfile.totalClicks) playerProfile.totalClicks = playerProfile.clicks; // make sure total clicks is always higher than clicks
    playerProfile.score += score;
    playerProfile.totalScore += score;
    if (context.rare) playerProfile.luckyPings += 1;
    playerProfile.bp = Math.min(currentEffects.bp + playerProfile.bp, bpMax);
    playerProfile.lastPing = Date.now();
    if (playerProfile.highestScore < score) playerProfile.highestScore = score; // update highest score

    if (!isSuper) {
        let missed = false;
        for (const messageButton of interaction.message.components[0].components) { // check every button in the first row
            if (messageButton.data.custom_id === 'ping:super') {
                missed = true;
                break;
            }
        }
        if (missed) playerProfile.bluePingsMissed += 1; // if the button is still there, it means they didn't click it
    }

    if (playerProfile.totalClicks >= 10000) {
        await awardBadge(interaction.user.id, 'heavy hands', interaction.client);
    }

    await playerProfile.save();

    // show upgrade popup after 150 clicks
    if (playerProfile.totalClicks === 150) {
        const button = new ButtonBuilder()
            .setLabel('that looks important...')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId('ping:empty')
            .setDisabled(true);
        const disabledRow = new ActionRowBuilder().addComponents(button);

        return await interaction.update({
            content:
                `${pingMessage}
you have a lot of pts... why don't you go spend them over in </upgrade:1360377407109861648>?`, // TODO: change to dynamically use ID
            components: [disabledRow]
        })
    }

    if (context.rare) {
        row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
                .setCustomId('ping:again')
                .setLabel('whoa!')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true),
            );
    } else {
        row = new ActionRowBuilder()
            .addComponents(rowComponents);
    }

    let displayDisplay = ""
    for (const dispType of ['add', 'mult', 'exponents', 'extra']) {
        const display = displays[dispType];
        if (display.length === 0) continue; // skip empty displays
        if (pingFormat === "expanded") {
            displayDisplay += ", " + display.join(', ') 
        } else {
            displayDisplay += ", " + display.join(' ')
        }

    }
    displayDisplay = displayDisplay.substring(2); // remove first comma and space
    
    if (currentEffects.bp) {
        displayDisplay += `\n-# \`${formatNumber(Math.ceil(playerProfile.bp))}/${formatNumber(bpMax)} bp\`${playerProfile.bp >= bpMax ? " **(MAX)**" : ""} `
        displayDisplay += displays.bp.join(', ');
    }

    try {
        // update ping
        await interaction.update({
            content:
                `${pingMessage}
\`${formatNumber(playerProfile.score, true, 4)} pts\` (**\`+${formatNumber(score, true, 3)}\`**)\n-# ${displayDisplay}`,
            components: [row]
        });
    } catch (error) {
        // automod error, since it doesn't like some messages
        if (error.code == 200000) {
            await interaction.update({
                content:
                    `this ping message is non-offensive, and contains nothing that will anger AutoMod! (${ping}ms)
\`${formatNumber(playerProfile.score, true, 4)} pts\` (**\`+${formatNumber(score, true, 3)}\`**)\n-# ${displayDisplay}`,
                components: [row]
            });
        } else {
            throw error; // rethrow if not automod 
        }
    }

    if (context.rare) {
        await (new Promise(resolve => setTimeout(resolve, 2000))); // wait a bit
        await interaction.editReply({
            components: [new ActionRowBuilder().addComponents(rowComponents)], // refresh buttons
        })
    }
}
