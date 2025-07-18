"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSwapImmediateInstruction = createSwapImmediateInstruction;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
const utils_1 = require("../utils");
function createSwapImmediateInstruction(params) {
    const { user, cpSwapProgram, poolId, amountIn, minAmountOut, isBaseInput, poolAuthorityBump, remainingAccounts } = params;
    const [fifoState] = (0, utils_1.getFifoStatePDA)();
    const keys = [
        { pubkey: fifoState, isSigner: false, isWritable: true },
        { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
        ...remainingAccounts
    ];
    // Instruction discriminator for swap_immediate
    const discriminator = Buffer.from([175, 131, 44, 121, 171, 170, 38, 18]);
    const data = Buffer.concat([
        discriminator,
        amountIn.toArrayLike(Buffer, 'le', 8),
        minAmountOut.toArrayLike(Buffer, 'le', 8),
        Buffer.from([isBaseInput ? 1 : 0]),
        poolId.toBuffer(),
        Buffer.from([poolAuthorityBump])
    ]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data
    });
}
