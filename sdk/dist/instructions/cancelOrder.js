"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCancelOrderInstruction = createCancelOrderInstruction;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
const pda_1 = require("../utils/pda");
function createCancelOrderInstruction(user, sequence) {
    const [orderState] = (0, pda_1.getOrderPDA)(user, sequence);
    const keys = [
        { pubkey: orderState, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: web3_js_1.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ];
    // Discriminator for cancel_order: [95, 129, 237, 240, 8, 49, 223, 132]
    const data = Buffer.from([95, 129, 237, 240, 8, 49, 223, 132]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data,
    });
}
