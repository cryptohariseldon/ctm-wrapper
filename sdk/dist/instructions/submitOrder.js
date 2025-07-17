"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSubmitOrderInstruction = createSubmitOrderInstruction;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
const pda_1 = require("../utils/pda");
const bn_js_1 = __importDefault(require("bn.js"));
async function createSubmitOrderInstruction(user, poolId, amountIn, minAmountOut, isBaseInput, currentSequence) {
    const [fifoState] = (0, pda_1.getFifoStatePDA)();
    const [poolRegistry] = (0, pda_1.getPoolRegistryPDA)(poolId);
    const nextSequence = currentSequence.add(new bn_js_1.default(1));
    const [orderState] = (0, pda_1.getOrderPDA)(user, nextSequence);
    const keys = [
        { pubkey: fifoState, isSigner: false, isWritable: true },
        { pubkey: poolRegistry, isSigner: false, isWritable: false },
        { pubkey: orderState, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: poolId, isSigner: false, isWritable: false },
        { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: web3_js_1.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ];
    // Discriminator for submit_order: [230, 150, 200, 53, 92, 208, 109, 108]
    const discriminator = Buffer.from([230, 150, 200, 53, 92, 208, 109, 108]);
    // Encode arguments
    const data = Buffer.concat([
        discriminator,
        amountIn.toArrayLike(Buffer, 'le', 8),
        minAmountOut.toArrayLike(Buffer, 'le', 8),
        Buffer.from([isBaseInput ? 1 : 0]),
    ]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data,
    });
}
