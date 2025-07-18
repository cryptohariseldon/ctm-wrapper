use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    instruction::{Instruction, AccountMeta},
};
use crate::state::*;
use crate::errors::ContinuumError;

#[derive(Accounts)]
pub struct SwapImmediate<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    
    /// The user performing the swap
    pub user: Signer<'info>,
    
    // All other accounts (pool_authority, pool_id, user accounts, etc.) 
    // are passed through in remaining_accounts to avoid deserialization
}

pub fn swap_immediate(
    ctx: Context<SwapImmediate>,
    amount_in: u64,
    min_amount_out: u64,
    is_base_input: bool,
    pool_id: Pubkey,
    pool_authority_bump: u8,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    
    // Increment sequence for tracking
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;
    
    msg!("Immediate swap {} on pool {}", sequence, pool_id);
    
    // Build the swap instruction data
    let mut ix_data = Vec::new();
    
    if is_base_input {
        // swap_base_input discriminator
        ix_data.extend_from_slice(&[143, 190, 90, 218, 196, 30, 51, 222]); 
        ix_data.extend_from_slice(&amount_in.to_le_bytes());
        ix_data.extend_from_slice(&min_amount_out.to_le_bytes());
    } else {
        // swap_base_output discriminator
        ix_data.extend_from_slice(&[55, 217, 98, 86, 163, 74, 180, 173]);
        ix_data.extend_from_slice(&min_amount_out.to_le_bytes()); // max_amount_in
        ix_data.extend_from_slice(&amount_in.to_le_bytes()); // amount_out
    }
    
    // Build account metas for CP-Swap
    let mut account_metas = vec![];
    
    // First account must be the user (payer/signer for CP-Swap)
    account_metas.push(AccountMeta::new_readonly(ctx.accounts.user.key(), true));
    
    // Add all remaining accounts as they were passed
    for account in ctx.remaining_accounts.iter() {
        account_metas.push(if account.is_writable {
            AccountMeta::new(account.key(), false)
        } else {
            AccountMeta::new_readonly(account.key(), false)
        });
    }
    
    // Create the instruction
    let ix = Instruction {
        program_id: ctx.accounts.cp_swap_program.key(),
        accounts: account_metas,
        data: ix_data,
    };
    
    // Invoke CP-Swap with pool authority signer
    let pool_authority_seeds = &[
        b"cp_pool_authority",
        pool_id.as_ref(),
        &[pool_authority_bump],
    ];
    
    // Build accounts list for invoke_signed: user + remaining_accounts
    let mut cpi_accounts = vec![ctx.accounts.user.to_account_info()];
    cpi_accounts.extend_from_slice(ctx.remaining_accounts);
    
    // Pass all accounts to invoke_signed
    invoke_signed(
        &ix,
        &cpi_accounts,
        &[pool_authority_seeds],
    )?;
    
    emit!(SwapExecuted {
        sequence,
        pool_id,
        amount_in,
        is_base_input,
    });
    
    msg!("Swap {} executed successfully", sequence);
    
    Ok(())
}

#[event]
pub struct SwapExecuted {
    pub sequence: u64,
    pub pool_id: Pubkey,
    pub amount_in: u64,
    pub is_base_input: bool,
}