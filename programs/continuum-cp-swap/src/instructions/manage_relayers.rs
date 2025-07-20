use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ContinuumError;

#[derive(Accounts)]
pub struct AddRelayer<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = fifo_state.admin == admin.key() @ ContinuumError::Unauthorized
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    pub admin: Signer<'info>,
    
    /// CHECK: The relayer to be added
    pub new_relayer: UncheckedAccount<'info>,
}

pub fn add_relayer(ctx: Context<AddRelayer>) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let new_relayer = ctx.accounts.new_relayer.key();
    
    // Check if relayer already exists
    if fifo_state.authorized_relayers.contains(&new_relayer) {
        return err!(ContinuumError::Unauthorized);
    }
    
    // Add the relayer
    fifo_state.authorized_relayers.push(new_relayer);
    
    msg!("Added relayer: {}", new_relayer);
    Ok(())
}

#[derive(Accounts)]
pub struct RemoveRelayer<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = fifo_state.admin == admin.key() @ ContinuumError::Unauthorized
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    pub admin: Signer<'info>,
    
    /// CHECK: The relayer to be removed
    pub relayer_to_remove: UncheckedAccount<'info>,
}

pub fn remove_relayer(ctx: Context<RemoveRelayer>) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let relayer_to_remove = ctx.accounts.relayer_to_remove.key();
    
    // Find and remove the relayer
    fifo_state.authorized_relayers.retain(|&r| r != relayer_to_remove);
    
    msg!("Removed relayer: {}", relayer_to_remove);
    Ok(())
}