use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct SubmitOrder<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    #[account(
        seeds = [b"pool_registry", pool_id.key().as_ref()],
        bump,
        constraint = pool_registry.is_active @ ContinuumError::PoolNotRegistered,
    )]
    pub pool_registry: Account<'info, CpSwapPoolRegistry>,
    
    #[account(
        init,
        payer = user,
        space = OrderState::LEN,
        seeds = [b"order", user.key().as_ref(), &fifo_state.current_sequence.to_le_bytes()],
        bump
    )]
    pub order_state: Account<'info, OrderState>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// CHECK: The pool ID to validate against registry
    pub pool_id: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn submit_order(
    ctx: Context<SubmitOrder>,
    amount_in: u64,
    min_amount_out: u64,
    is_base_input: bool,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let order_state = &mut ctx.accounts.order_state;
    let clock = &ctx.accounts.clock;
    
    // Increment sequence
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;
    
    // Store order details
    order_state.sequence = sequence;
    order_state.user = ctx.accounts.user.key();
    order_state.pool_id = ctx.accounts.pool_id.key();
    order_state.amount_in = amount_in;
    order_state.min_amount_out = min_amount_out;
    order_state.is_base_input = is_base_input;
    order_state.status = OrderStatus::Pending;
    order_state.submitted_at = clock.unix_timestamp;
    order_state.executed_at = None;
    
    emit!(OrderSubmitted {
        sequence,
        user: ctx.accounts.user.key(),
        pool_id: ctx.accounts.pool_id.key(),
        amount_in,
        is_base_input,
    });
    
    msg!("Order {} submitted by user {}", sequence, ctx.accounts.user.key());
    
    Ok(())
}