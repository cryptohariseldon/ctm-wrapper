"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitializeInstruction = createInitializeInstruction;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
const pda_1 = require("../utils/pda");
function createInitializeInstruction(admin) {
    const [fifoState] = (0, pda_1.getFifoStatePDA)();
    const keys = [
        { pubkey: fifoState, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    // Discriminator for initialize: [175, 175, 109, 31, 13, 152, 155, 237]
    const data = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data,
    });
}
