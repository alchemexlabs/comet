-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create tables
CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    pool_address TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    status TEXT NOT NULL,
    strategy TEXT NOT NULL,
    bin_range INTEGER NOT NULL,
    auto_rebalance BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pools (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    token_x_address TEXT NOT NULL,
    token_y_address TEXT NOT NULL,
    token_x_symbol TEXT,
    token_y_symbol TEXT,
    bin_step INTEGER NOT NULL,
    active_bin_id INTEGER,
    fee_bps INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    pool_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    min_bin_id INTEGER NOT NULL,
    max_bin_id INTEGER NOT NULL,
    liquidity_x NUMERIC(78, 0) NOT NULL,
    liquidity_y NUMERIC(78, 0) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Time-series tables
CREATE TABLE IF NOT EXISTS pool_metrics (
    time TIMESTAMPTZ NOT NULL,
    pool_address TEXT NOT NULL,
    active_bin_id INTEGER,
    current_price NUMERIC,
    token_x_price_usd NUMERIC,
    token_y_price_usd NUMERIC,
    liquidity_x NUMERIC(78, 0),
    liquidity_y NUMERIC(78, 0),
    total_value_locked_usd NUMERIC,
    volume_24h NUMERIC,
    fees_24h NUMERIC
);

-- Convert to hypertable (TimescaleDB)
SELECT create_hypertable('pool_metrics', 'time');

CREATE TABLE IF NOT EXISTS rebalance_events (
    time TIMESTAMPTZ NOT NULL,
    agent_id INTEGER NOT NULL,
    pool_address TEXT NOT NULL,
    old_active_bin INTEGER,
    new_active_bin INTEGER,
    old_price NUMERIC,
    new_price NUMERIC,
    transaction_hash TEXT,
    success BOOLEAN NOT NULL,
    error_message TEXT
);

-- Convert to hypertable (TimescaleDB)
SELECT create_hypertable('rebalance_events', 'time');

CREATE TABLE IF NOT EXISTS fee_collection_events (
    time TIMESTAMPTZ NOT NULL,
    agent_id INTEGER NOT NULL,
    pool_address TEXT NOT NULL,
    position_address TEXT NOT NULL,
    amount_x NUMERIC(78, 0),
    amount_y NUMERIC(78, 0),
    amount_x_usd NUMERIC,
    amount_y_usd NUMERIC,
    transaction_hash TEXT,
    success BOOLEAN NOT NULL,
    error_message TEXT
);

-- Convert to hypertable (TimescaleDB)
SELECT create_hypertable('fee_collection_events', 'time');

-- Create indices for better query performance
CREATE INDEX ON pool_metrics (pool_address, time DESC);
CREATE INDEX ON rebalance_events (pool_address, time DESC);
CREATE INDEX ON fee_collection_events (pool_address, time DESC);
CREATE INDEX ON fee_collection_events (position_address, time DESC);

-- Create relations between tables
ALTER TABLE positions ADD CONSTRAINT fk_pool 
    FOREIGN KEY (pool_address) REFERENCES pools(address);

ALTER TABLE rebalance_events ADD CONSTRAINT fk_agent 
    FOREIGN KEY (agent_id) REFERENCES agents(id);

ALTER TABLE fee_collection_events ADD CONSTRAINT fk_agent 
    FOREIGN KEY (agent_id) REFERENCES agents(id);

-- Create retention policy (keep data for 1 year by default)
SELECT add_retention_policy('pool_metrics', INTERVAL '1 year');
SELECT add_retention_policy('rebalance_events', INTERVAL '1 year');
SELECT add_retention_policy('fee_collection_events', INTERVAL '1 year');