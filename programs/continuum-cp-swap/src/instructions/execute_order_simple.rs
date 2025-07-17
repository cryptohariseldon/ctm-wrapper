use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    instruction::{Instruction, AccountMeta},
};
use anchor_spl::token::{Token, TokenAccount};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct ExecuteOrderSimple<'info> {
    #[account(
        seeds = [b"fifo_state"],
        bump,
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    #[account(
        seeds = [b"pool_registry", pool_id.key().as_ref()],
        bump,
    )]
    pub pool_registry: Account<'info, CpSwapPoolRegistry>,
    
    /// The pool authority PDA that signs for the swap
    /// CHECK: This is a PDA that will be used to sign the CPI
    #[account(
        seeds = [b"cp_pool_authority", pool_id.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    /// CHECK: The pool to swap in
    pub pool_id: UncheckedAccount<'info>,
    
    /// The relayer executing the order
    #[account(mut)]
    pub executor: Signer<'info>,
    
    /// User performing the swap
    /// CHECK: User account that owns the tokens
    pub user: UncheckedAccount<'info>,
    
    /// User's source token account
    #[account(
        mut,
        constraint = user_source.owner == user.key(),
    )]
    pub user_source: Account<'info, TokenAccount>,
    
    /// User's destination token account
    #[account(
        mut,
        constraint = user_destination.owner == user.key(),
    )]
    pub user_destination: Account<'info, TokenAccount>,
    
    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
    
    // Remaining accounts are passed through to CP-Swap swap instruction
}

pub fn execute_order_simple(
    ctx: Context<ExecuteOrderSimple>,
    sequence: u64,
    amount_in: u64,
    min_amount_out: u64,
    is_base_input: bool,
) -> Result<()> {
    let pool_authority_bump = ctx.bumps.pool_authority;
    let pool_id = ctx.accounts.pool_id.key();
    
    msg!("Executing order {} for user {} on pool {}", 
        sequence,
        ctx.accounts.user.key(),
        pool_id
    );
    
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
    
    // Build account metas
    let mut account_metas = vec![];
    
    // Add the pool authority as the first account (signer)
    account_metas.push(AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), true));
    
    // Add user token accounts
    account_metas.push(AccountMeta::new(ctx.accounts.user_source.key(), false));
    account_metas.push(AccountMeta::new(ctx.accounts.user_destination.key(), false));
    
    // Add remaining accounts (pool state, vaults, etc.)
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
    
    invoke_signed(
        &ix,
        &[
            ctx.accounts.pool_authority.to_account_info(),
            ctx.accounts.user_source.to_account_info(),
            ctx.accounts.user_destination.to_account_info(),
        ]
        .iter()
        .chain(ctx.remaining_accounts.iter())
        .cloned()
        .collect::<Vec<_>>()[..],
        &[pool_authority_seeds],
    )?;
    
    emit!(OrderExecuted {
        sequence,
        user: ctx.accounts.user.key(),
        amount_out: 0, // TODO: Extract from return data
        executor: ctx.accounts.executor.key(),
    });
    
    msg!("Order {} executed successfully", sequence);
    
    Ok(())
}