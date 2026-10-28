export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          archived_at: string | null
          bank_type: string | null
          created_at: string
          currency: string
          id: string
          institution: string | null
          kind: string
          last4: string | null
          name: string
          opening_balance_date: string
          opening_balance_minor: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          bank_type?: string | null
          created_at?: string
          currency: string
          id?: string
          institution?: string | null
          kind: string
          last4?: string | null
          name: string
          opening_balance_date: string
          opening_balance_minor?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          bank_type?: string | null
          created_at?: string
          currency?: string
          id?: string
          institution?: string | null
          kind?: string
          last4?: string | null
          name?: string
          opening_balance_date?: string
          opening_balance_minor?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      borrowings: {
        Row: {
          account_id: string
          archived_at: string | null
          borrowed_minor: number
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          amount_to_return_minor: number
          instalment_count: number | null
          lender: string
          reason: string | null
          receipt_transaction_id: string | null
          relationship: string | null
          repay_from_account_id: string | null
          return_on: string | null
          return_plan: string | null
          received_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          borrowed_minor: number
          created_at?: string
          currency: string
          id?: string
          idempotency_key: string
          amount_to_return_minor: number
          instalment_count?: number | null
          lender: string
          reason?: string | null
          receipt_transaction_id?: string | null
          relationship?: string | null
          repay_from_account_id?: string | null
          return_on?: string | null
          return_plan?: string | null
          received_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          borrowed_minor?: number
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          amount_to_return_minor?: number
          instalment_count?: number | null
          lender?: string
          reason?: string | null
          receipt_transaction_id?: string | null
          relationship?: string | null
          repay_from_account_id?: string | null
          return_on?: string | null
          return_plan?: string | null
          received_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "borrowings_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "borrowings_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "borrowings_repay_from_owned"
            columns: ["repay_from_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "borrowings_repay_from_owned"
            columns: ["repay_from_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "borrowings_receipt_owned"
            columns: ["receipt_transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount_minor: number
          category_id: string
          created_at: string
          currency: string
          effective_from: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          category_id: string
          created_at?: string
          currency: string
          effective_from: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount_minor?: number
          category_id?: string
          created_at?: string
          currency?: string
          effective_from?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_owned"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      card_statements: {
        Row: {
          card_id: string
          created_at: string
          difference_minor: number
          difference_transaction_id: string | null
          due_date: string
          emi_included_minor: number
          id: string
          idempotency_key: string
          minimum_minor: number
          owed_at_statement_minor: number | null
          statement_date: string
          total_minor: number
          user_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          difference_minor?: number
          difference_transaction_id?: string | null
          due_date: string
          emi_included_minor?: number
          id?: string
          idempotency_key: string
          minimum_minor?: number
          owed_at_statement_minor?: number | null
          statement_date: string
          total_minor: number
          user_id?: string
        }
        Update: {
          card_id?: string
          created_at?: string
          difference_minor?: number
          difference_transaction_id?: string | null
          due_date?: string
          emi_included_minor?: number
          id?: string
          idempotency_key?: string
          minimum_minor?: number
          owed_at_statement_minor?: number | null
          statement_date?: string
          total_minor?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_statements_card_owned"
            columns: ["card_id", "user_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "card_statements_difference_owned"
            columns: ["difference_transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      categories: {
        Row: {
          archived_at: string | null
          created_at: string
          default_account_id: string | null
          icon: string | null
          id: string
          is_default: boolean
          key: string | null
          kind: string
          name: string
          source_type: string | null
          system_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          default_account_id?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean
          key?: string | null
          kind: string
          name: string
          source_type?: string | null
          system_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          default_account_id?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean
          key?: string | null
          kind?: string
          name?: string
          source_type?: string | null
          system_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_default_account_owned"
            columns: ["default_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "categories_default_account_owned"
            columns: ["default_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      credit_cards: {
        Row: {
          account_id: string
          archived_at: string | null
          created_at: string
          currency: string
          due_day: number
          id: string
          idempotency_key: string
          issuer: string
          limit_minor: number
          nickname: string | null
          opening_owed_minor: number
          product: string | null
          product_other: boolean
          statement_day: number
          tracking_started_on: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          created_at?: string
          currency: string
          due_day: number
          id?: string
          idempotency_key: string
          issuer: string
          limit_minor: number
          nickname?: string | null
          opening_owed_minor: number
          product?: string | null
          product_other?: boolean
          statement_day: number
          tracking_started_on: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          created_at?: string
          currency?: string
          due_day?: number
          id?: string
          idempotency_key?: string
          issuer?: string
          limit_minor?: number
          nickname?: string | null
          opening_owed_minor?: number
          product?: string | null
          product_other?: boolean
          statement_day?: number
          tracking_started_on?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_cards_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "credit_cards_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      due_items: {
        Row: {
          amount_due_minor: number
          borrowing_id: string | null
          card_statement_id: string | null
          created_at: string
          currency: string
          due_date: string
          id: string
          kind: string
          loan_id: string | null
          interest_minor: number | null
          minimum_due_minor: number | null
          pay_from_account_id: string | null
          planned_account_id: string | null
          planned_on: string | null
          seq: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_due_minor: number
          borrowing_id?: string | null
          card_statement_id?: string | null
          created_at?: string
          currency: string
          due_date: string
          id?: string
          kind: string
          loan_id?: string | null
          interest_minor?: number | null
          minimum_due_minor?: number | null
          pay_from_account_id?: string | null
          planned_account_id?: string | null
          planned_on?: string | null
          seq: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount_due_minor?: number
          borrowing_id?: string | null
          card_statement_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string
          id?: string
          kind?: string
          loan_id?: string | null
          interest_minor?: number | null
          minimum_due_minor?: number | null
          pay_from_account_id?: string | null
          planned_account_id?: string | null
          planned_on?: string | null
          seq?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "due_items_borrowing_owned"
            columns: ["borrowing_id", "user_id"]
            isOneToOne: false
            referencedRelation: "borrowings"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "due_items_card_statement_owned"
            columns: ["card_statement_id", "user_id"]
            isOneToOne: false
            referencedRelation: "card_statements"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "due_items_loan_owned"
            columns: ["loan_id", "user_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "due_items_pay_from_owned"
            columns: ["pay_from_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "due_items_pay_from_owned"
            columns: ["pay_from_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "due_items_planned_account_owned"
            columns: ["planned_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "due_items_planned_account_owned"
            columns: ["planned_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      due_payments: {
        Row: {
          account_id: string
          capitalised_minor: number
          created_at: string
          due_item_id: string
          fees_minor: number
          id: string
          idempotency_key: string
          interest_minor: number
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          account_id: string
          capitalised_minor?: number
          created_at?: string
          due_item_id: string
          fees_minor?: number
          id?: string
          idempotency_key: string
          interest_minor?: number
          paid_on: string
          principal_minor?: number
          replaces_id?: string | null
          user_id?: string
          void_idempotency_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          account_id?: string
          capitalised_minor?: number
          created_at?: string
          due_item_id?: string
          fees_minor?: number
          id?: string
          idempotency_key?: string
          interest_minor?: number
          paid_on?: string
          principal_minor?: number
          replaces_id?: string | null
          user_id?: string
          void_idempotency_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "due_payments_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "due_payments_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "due_payments_item_owned"
            columns: ["due_item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "card_bill_progress"
            referencedColumns: ["due_item_id", "user_id"]
          },
          {
            foreignKeyName: "due_payments_item_owned"
            columns: ["due_item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "due_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "due_payments_replaces_owned"
            columns: ["replaces_id", "user_id"]
            isOneToOne: false
            referencedRelation: "due_payments"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      fixed_deposits: {
        Row: {
          archived_at: string | null
          bank: string
          compounding: string
          created_at: string
          id: string
          idempotency_key: string
          label: string | null
          maturity_date: string
          principal_minor: number
          rate_bps: number
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          bank: string
          compounding?: string
          created_at?: string
          id?: string
          idempotency_key: string
          label?: string | null
          maturity_date: string
          principal_minor: number
          rate_bps: number
          start_date: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          bank?: string
          compounding?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          label?: string | null
          maturity_date?: string
          principal_minor?: number
          rate_bps?: number
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          archived_at: string | null
          created_at: string
          currency: string
          details: Json
          id: string
          idempotency_key: string
          name: string
          saved_amount_minor: number
          target_amount_minor: number
          target_date: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          currency: string
          details: Json
          id?: string
          idempotency_key: string
          name: string
          saved_amount_minor?: number
          target_amount_minor: number
          target_date?: string | null
          type: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          idempotency_key?: string
          name?: string
          saved_amount_minor?: number
          target_amount_minor?: number
          target_date?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      instruments: {
        Row: {
          created_at: string
          id: string
          isin: string | null
          kind: string
          last_price_scaled: number
          name: string
          price_date: string
          source: string
          source_code: string
          symbol: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          isin?: string | null
          kind: string
          last_price_scaled: number
          name: string
          price_date: string
          source: string
          source_code: string
          symbol?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          isin?: string | null
          kind?: string
          last_price_scaled?: number
          name?: string
          price_date?: string
          source?: string
          source_code?: string
          symbol?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      investments: {
        Row: {
          archived_at: string | null
          buy_date: string
          buy_price_scaled: number
          created_at: string
          id: string
          idempotency_key: string
          instrument_id: string
          isin_at_entry: string | null
          units_scaled: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          buy_date: string
          buy_price_scaled: number
          created_at?: string
          id?: string
          idempotency_key: string
          instrument_id: string
          isin_at_entry?: string | null
          units_scaled: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          buy_date?: string
          buy_price_scaled?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          instrument_id?: string
          isin_at_entry?: string | null
          units_scaled?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investments_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      liability_payments: {
        Row: {
          account_id: string
          created_at: string
          id: string
          idempotency_key: string
          interest_minor: number
          liability_account_id: string
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          interest_minor?: number
          liability_account_id: string
          paid_on: string
          principal_minor?: number
          replaces_id?: string | null
          user_id?: string
          void_idempotency_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          interest_minor?: number
          liability_account_id?: string
          paid_on?: string
          principal_minor?: number
          replaces_id?: string | null
          user_id?: string
          void_idempotency_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "liability_payments_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "liability_payments_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "liability_payments_liability_owned"
            columns: ["liability_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "liability_payments_liability_owned"
            columns: ["liability_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "liability_payments_replaces_owned"
            columns: ["replaces_id", "user_id"]
            isOneToOne: false
            referencedRelation: "liability_payments"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      loans: {
        Row: {
          account_id: string
          archived_at: string | null
          capitalised_minor: number
          card_id: string | null
          created_at: string
          currency: string
          disbursed_minor: number
          emi_estimate_minor: number
          emi_minor: number
          first_due_date: string
          id: string
          idempotency_key: string
          instalment_months: number
          lender: string
          loan_type: string
          moratorium_interest: string | null
          moratorium_months: number
          nickname: string | null
          opening_outstanding_minor: number
          rate_bps: number
          rate_kind: string
          sanctioned_minor: number
          start_mode: string
          tenure_months: number
          tracking_started_on: string
          type_other: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          capitalised_minor?: number
          card_id?: string | null
          created_at?: string
          currency: string
          disbursed_minor: number
          emi_estimate_minor: number
          emi_minor: number
          first_due_date: string
          id?: string
          idempotency_key: string
          instalment_months: number
          lender: string
          loan_type: string
          moratorium_interest?: string | null
          moratorium_months?: number
          nickname?: string | null
          opening_outstanding_minor: number
          rate_bps: number
          rate_kind?: string
          sanctioned_minor: number
          start_mode: string
          tenure_months: number
          tracking_started_on: string
          type_other?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          capitalised_minor?: number
          card_id?: string | null
          created_at?: string
          currency?: string
          disbursed_minor?: number
          emi_estimate_minor?: number
          emi_minor?: number
          first_due_date?: string
          id?: string
          idempotency_key?: string
          instalment_months?: number
          lender?: string
          loan_type?: string
          moratorium_interest?: string | null
          moratorium_months?: number
          nickname?: string | null
          opening_outstanding_minor?: number
          rate_bps?: number
          rate_kind?: string
          sanctioned_minor?: number
          start_mode?: string
          tenure_months?: number
          tracking_started_on?: string
          type_other?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "loans_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "loans_card_owned"
            columns: ["card_id", "user_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      price_refresh_runs: {
        Row: {
          error: string | null
          finished_at: string
          id: string
          price_date: string | null
          rows_loaded: number
          rows_seen: number
          rows_skipped: number
          skip_reasons: Json
          source: string
          started_at: string
          status: string
        }
        Insert: {
          error?: string | null
          finished_at: string
          id?: string
          price_date?: string | null
          rows_loaded?: number
          rows_seen?: number
          rows_skipped?: number
          skip_reasons?: Json
          source: string
          started_at: string
          status: string
        }
        Update: {
          error?: string | null
          finished_at?: string
          id?: string
          price_date?: string | null
          rows_loaded?: number
          rows_seen?: number
          rows_skipped?: number
          skip_reasons?: Json
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country: string
          created_at: string
          currency: string
          display_name: string | null
          id: string
          phone: string | null
          time_zone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          country?: string
          created_at?: string
          currency?: string
          display_name?: string | null
          id: string
          phone?: string | null
          time_zone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          country?: string
          created_at?: string
          currency?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          time_zone?: string
          updated_at?: string
        }
        Relationships: []
      }
      recurring_rules: {
        Row: {
          account_id: string
          amount_minor: number
          archived_at: string | null
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          end_date: string | null
          frequency: string
          id: string
          idempotency_key: string
          note: string | null
          payment_mode: string | null
          start_date: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount_minor: number
          archived_at?: string | null
          category_id?: string | null
          counter_account_id?: string | null
          created_at?: string
          currency: string
          end_date?: string | null
          frequency: string
          id?: string
          idempotency_key: string
          note?: string | null
          payment_mode?: string | null
          start_date: string
          type: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          amount_minor?: number
          archived_at?: string | null
          category_id?: string | null
          counter_account_id?: string | null
          created_at?: string
          currency?: string
          end_date?: string | null
          frequency?: string
          id?: string
          idempotency_key?: string
          note?: string | null
          payment_mode?: string | null
          start_date?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_rules_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "recurring_rules_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "recurring_rules_category_owned"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "recurring_rules_counter_account_owned"
            columns: ["counter_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "recurring_rules_counter_account_owned"
            columns: ["counter_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      recurring_skips: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          occurrence_date: string
          reason: string | null
          rule_id: string
          undone_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          occurrence_date: string
          reason?: string | null
          rule_id: string
          undone_at?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          occurrence_date?: string
          reason?: string | null
          rule_id?: string
          undone_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_skips_rule_owned"
            columns: ["rule_id", "user_id"]
            isOneToOne: false
            referencedRelation: "recurring_rule_progress"
            referencedColumns: ["rule_id", "user_id"]
          },
          {
            foreignKeyName: "recurring_skips_rule_owned"
            columns: ["rule_id", "user_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          account_id: string
          amount_minor: number
          category_id?: string | null
          counter_account_id?: string | null
          created_at?: string
          currency: string
          due_payment_id?: string | null
          id?: string
          idempotency_key: string
          liability_payment_id?: string | null
          note?: string | null
          occurred_on: string
          occurrence_date?: string | null
          payment_mode?: string | null
          recurring_rule_id?: string | null
          replaces_id?: string | null
          type: string
          user_id?: string
          void_idempotency_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          account_id?: string
          amount_minor?: number
          category_id?: string | null
          counter_account_id?: string | null
          created_at?: string
          currency?: string
          due_payment_id?: string | null
          id?: string
          idempotency_key?: string
          liability_payment_id?: string | null
          note?: string | null
          occurred_on?: string
          occurrence_date?: string | null
          payment_mode?: string | null
          recurring_rule_id?: string | null
          replaces_id?: string | null
          type?: string
          user_id?: string
          void_idempotency_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "transactions_account_owned"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_category_owned"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_counter_account_owned"
            columns: ["counter_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "transactions_counter_account_owned"
            columns: ["counter_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_due_payment_owned"
            columns: ["due_payment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "due_payments"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_liability_payment_owned"
            columns: ["liability_payment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "liability_payments"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_recurring_rule_owned"
            columns: ["recurring_rule_id", "user_id"]
            isOneToOne: false
            referencedRelation: "recurring_rule_progress"
            referencedColumns: ["rule_id", "user_id"]
          },
          {
            foreignKeyName: "transactions_recurring_rule_owned"
            columns: ["recurring_rule_id", "user_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_replaces_owned"
            columns: ["replaces_id", "user_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
    }
    Views: {
      account_balances: {
        Row: {
          account_id: string | null
          inflow_minor: number | null
          last_activity_at: string | null
          outflow_minor: number | null
          user_id: string | null
        }
        Relationships: []
      }
      borrowing_due_progress: {
        Row: {
          borrowing_id: string | null
          due_item_id: string | null
          remaining_interest_minor: number | null
          remaining_minor: number | null
          remaining_principal_minor: number | null
          seq: number | null
          user_id: string | null
        }
        Relationships: []
      }
      card_bill_progress: {
        Row: {
          card_id: string | null
          due_item_id: string | null
          paid_minor: number | null
          user_id: string | null
        }
        Relationships: []
      }
      recurring_rule_progress: {
        Row: {
          last_posted_on: string | null
          last_skipped_on: string | null
          rule_id: string | null
          user_id: string | null
        }
        Insert: {
          last_posted_on?: never
          last_skipped_on?: never
          rule_id?: string | null
          user_id?: string | null
        }
        Update: {
          last_posted_on?: never
          last_skipped_on?: never
          rule_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      backfill_default_expense_categories: { Args: never; Returns: number }
      backfill_default_income_sources: { Args: never; Returns: number }
      backfill_missing_profiles: { Args: never; Returns: number }
      borrowing_sync_due: {
        Args: { p_borrowing_id: string }
        Returns: undefined
      }
      card_bill_paid: { Args: { p_due_item_id: string }; Returns: number }
      card_cycle_date: {
        Args: { p_day: number; p_month: string }
        Returns: string
      }
      card_due_date: {
        Args: { p_due_day: number; p_statement_date: string }
        Returns: string
      }
      card_sync_due: { Args: { p_card_id: string }; Returns: undefined }
      confirm_recurring_occurrence: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_counter_account_id?: string
          p_idempotency_key: string
          p_note?: string
          p_occurred_on: string
          p_occurrence_date: string
          p_payment_mode?: string
          p_rule_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_borrowing: {
        Args: {
          p_amount_minor: number
          p_amount_to_return_minor?: number
          p_idempotency_key: string
          p_instalment_count?: number
          p_lender: string
          p_pay_from_account_id?: string
          p_reason?: string
          p_received_account_id?: string
          p_received_on?: string
          p_relationship: string
          p_return_on?: string
          p_return_plan?: string
        }
        Returns: {
          account_id: string
          archived_at: string | null
          borrowed_minor: number
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          amount_to_return_minor: number
          instalment_count: number | null
          lender: string
          reason: string | null
          receipt_transaction_id: string | null
          relationship: string | null
          repay_from_account_id: string | null
          return_on: string | null
          return_plan: string | null
          received_on: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "borrowings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_card: {
        Args: {
          p_due_day: number
          p_idempotency_key: string
          p_issuer: string
          p_limit_minor: number
          p_nickname?: string
          p_opening_owed_minor?: number
          p_product?: string
          p_product_other?: boolean
          p_statement_day: number
        }
        Returns: {
          account_id: string
          archived_at: string | null
          created_at: string
          currency: string
          due_day: number
          id: string
          idempotency_key: string
          issuer: string
          limit_minor: number
          nickname: string | null
          opening_owed_minor: number
          product: string | null
          product_other: boolean
          statement_day: number
          tracking_started_on: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_cards"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_loan: {
        Args: {
          p_before_tracking_on?: string
          p_capitalised_minor?: number
          p_disbursed_minor: number
          p_emi_estimate_minor: number
          p_emi_minor: number
          p_first_due_date: string
          p_idempotency_key: string
          p_instalment_months: number
          p_lender: string
          p_loan_type: string
          p_moratorium_interest?: string
          p_moratorium_interest_minor?: number
          p_moratorium_months?: number
          p_nickname?: string
          p_outstanding_minor: number
          p_rate_bps: number
          p_rate_kind: string
          p_sanctioned_minor: number
          p_start_mode: string
          p_tenure_months: number
          p_type_other?: string
        }
        Returns: {
          account_id: string
          archived_at: string | null
          capitalised_minor: number
          card_id: string | null
          created_at: string
          currency: string
          disbursed_minor: number
          emi_estimate_minor: number
          emi_minor: number
          first_due_date: string
          id: string
          idempotency_key: string
          instalment_months: number
          lender: string
          loan_type: string
          moratorium_interest: string | null
          moratorium_months: number
          nickname: string | null
          opening_outstanding_minor: number
          rate_bps: number
          rate_kind: string
          sanctioned_minor: number
          start_mode: string
          tenure_months: number
          tracking_started_on: string
          type_other: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_recurring_rule: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_category_id?: string
          p_counter_account_id?: string
          p_end_date?: string
          p_frequency: string
          p_idempotency_key: string
          p_note?: string
          p_payment_mode?: string
          p_start_date: string
          p_type: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          archived_at: string | null
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          end_date: string | null
          frequency: string
          id: string
          idempotency_key: string
          note: string | null
          payment_mode: string | null
          start_date: string
          type: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dashboard_breakdown: {
        Args: { p_from: string; p_to: string }
        Returns: {
          bucket_start: string
          category_id: string
          currency: string
          entry_count: number
          expense_minor: number
          income_minor: number
          kind: string
        }[]
      }
      delete_borrowing: { Args: { p_borrowing_id: string }; Returns: undefined }
      delete_card: { Args: { p_card_id: string }; Returns: undefined }
      delete_card_statement: {
        Args: { p_statement_id: string }
        Returns: undefined
      }
      delete_loan: { Args: { p_loan_id: string }; Returns: undefined }
      edit_due_payment: {
        Args: {
          p_account_id: string
          p_allow_shortfall?: boolean
          p_fees_minor: number
          p_idempotency_key: string
          p_interest_minor: number
          p_paid_on: string
          p_payment_id: string
          p_principal_minor: number
        }
        Returns: {
          account_id: string
          capitalised_minor: number
          created_at: string
          due_item_id: string
          fees_minor: number
          id: string
          idempotency_key: string
          interest_minor: number
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "due_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      edit_liability_payment: {
        Args: {
          p_account_id: string
          p_allow_shortfall?: boolean
          p_idempotency_key: string
          p_interest_minor?: number
          p_paid_on: string
          p_payment_id: string
          p_principal_minor: number
        }
        Returns: {
          account_id: string
          created_at: string
          id: string
          idempotency_key: string
          interest_minor: number
          liability_account_id: string
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "liability_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      edit_transaction: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_category_id?: string
          p_counter_account_id?: string
          p_idempotency_key: string
          p_note?: string
          p_occurred_on: string
          p_payment_mode?: string
          p_transaction_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_default_expense_categories: {
        Args: { p_user_id: string }
        Returns: number
      }
      ensure_default_income_sources: {
        Args: { p_user_id: string }
        Returns: number
      }
      ensure_my_expense_categories: { Args: never; Returns: number }
      ensure_my_income_sources: { Args: never; Returns: number }
      enter_card_statement: {
        Args: {
          p_card_id: string
          p_difference_category_id?: string
          p_due_date?: string
          p_emi_included_minor?: number
          p_idempotency_key: string
          p_minimum_minor?: number
          p_statement_date: string
          p_total_minor: number
        }
        Returns: {
          card_id: string
          created_at: string
          difference_minor: number
          difference_transaction_id: string | null
          due_date: string
          emi_included_minor: number
          id: string
          idempotency_key: string
          minimum_minor: number
          owed_at_statement_minor: number | null
          statement_date: string
          total_minor: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "card_statements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_liability_kind: { Args: { p_kind: string }; Returns: boolean }
      liability_owed: {
        Args: { p_account_id: string; p_as_of?: string }
        Returns: number
      }
      link_card_emi: {
        Args: { p_card_id?: string; p_loan_id: string }
        Returns: {
          account_id: string
          archived_at: string | null
          capitalised_minor: number
          card_id: string | null
          created_at: string
          currency: string
          disbursed_minor: number
          emi_estimate_minor: number
          emi_minor: number
          first_due_date: string
          id: string
          idempotency_key: string
          instalment_months: number
          lender: string
          loan_type: string
          moratorium_interest: string | null
          moratorium_months: number
          nickname: string | null
          opening_outstanding_minor: number
          rate_bps: number
          rate_kind: string
          sanctioned_minor: number
          start_mode: string
          tenure_months: number
          tracking_started_on: string
          type_other: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_transactions: {
        Args: {
          p_account_id?: string
          p_after_created_at?: string
          p_after_id?: string
          p_after_occurred_on?: string
          p_amount_minor?: number
          p_category_id?: string
          p_from: string
          p_include_voided?: boolean
          p_limit?: number
          p_query?: string
          p_to: string
          p_type?: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      loan_category_id: { Args: { p_key: string }; Returns: string }
      loan_due_date: {
        Args: { p_first_due: string; p_seq: number }
        Returns: string
      }
      pay_card: {
        Args: {
          p_account_id: string
          p_allow_shortfall?: boolean
          p_amount_minor: number
          p_card_id: string
          p_idempotency_key: string
          p_paid_on: string
        }
        Returns: {
          account_id: string
          created_at: string
          id: string
          idempotency_key: string
          interest_minor: number
          liability_account_id: string
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "liability_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_due_item: {
        Args: {
          p_account_id: string
          p_allow_shortfall?: boolean
          p_due_item_id: string
          p_fees_minor: number
          p_idempotency_key: string
          p_interest_minor: number
          p_paid_on: string
          p_principal_minor: number
          p_replaces_id?: string
        }
        Returns: {
          account_id: string
          capitalised_minor: number
          created_at: string
          due_item_id: string
          fees_minor: number
          id: string
          idempotency_key: string
          interest_minor: number
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "due_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      post_liability_payment: {
        Args: {
          p_account_id: string
          p_allow_shortfall?: boolean
          p_idempotency_key: string
          p_interest_minor?: number
          p_liability_account_id: string
          p_paid_on: string
          p_principal_minor: number
          p_replaces_id?: string
        }
        Returns: {
          account_id: string
          created_at: string
          id: string
          idempotency_key: string
          interest_minor: number
          liability_account_id: string
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "liability_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      profile_display_name: { Args: { meta: Json }; Returns: string }
      record_income: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_category_id: string
          p_idempotency_key: string
          p_note?: string
          p_occurred_on: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_transaction: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_category_id?: string
          p_counter_account_id?: string
          p_idempotency_key: string
          p_note?: string
          p_occurred_on: string
          p_payment_mode?: string
          p_type: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recurring_is_occurrence: {
        Args: {
          p_date: string
          p_end: string
          p_frequency: string
          p_start: string
        }
        Returns: boolean
      }
      recurring_month_match: {
        Args: { p_date: string; p_start: string; p_step: number }
        Returns: boolean
      }
      repay_borrowing: {
        Args: {
          p_account_id: string
          p_allow_shortfall?: boolean
          p_borrowing_id: string
          p_idempotency_key: string
          p_interest_minor?: number
          p_paid_on: string
          p_principal_minor: number
        }
        Returns: {
          account_id: string
          created_at: string
          id: string
          idempotency_key: string
          interest_minor: number
          liability_account_id: string
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "liability_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_instruments: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          created_at: string
          id: string
          isin: string | null
          kind: string
          last_price_scaled: number
          name: string
          price_date: string
          source: string
          source_code: string
          symbol: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "instruments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_borrowing_archived: {
        Args: { p_archived: boolean; p_borrowing_id: string }
        Returns: {
          account_id: string
          archived_at: string | null
          borrowed_minor: number
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          amount_to_return_minor: number
          instalment_count: number | null
          lender: string
          reason: string | null
          receipt_transaction_id: string | null
          relationship: string | null
          repay_from_account_id: string | null
          return_on: string | null
          return_plan: string | null
          received_on: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "borrowings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_borrowing_return_plan: {
        Args: {
          p_amount_to_return_minor: number
          p_borrowing_id: string
          p_instalment_count?: number
          p_pay_from_account_id?: string
          p_return_on?: string
          p_return_plan?: string
        }
        Returns: {
          account_id: string
          archived_at: string | null
          borrowed_minor: number
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          amount_to_return_minor: number
          instalment_count: number | null
          lender: string
          reason: string | null
          receipt_transaction_id: string | null
          relationship: string | null
          repay_from_account_id: string | null
          return_on: string | null
          return_plan: string | null
          received_on: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "borrowings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_card_archived: {
        Args: { p_archived: boolean; p_card_id: string }
        Returns: {
          account_id: string
          archived_at: string | null
          created_at: string
          currency: string
          due_day: number
          id: string
          idempotency_key: string
          issuer: string
          limit_minor: number
          nickname: string | null
          opening_owed_minor: number
          product: string | null
          product_other: boolean
          statement_day: number
          tracking_started_on: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_cards"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_cash_on_hand: {
        Args: { p_account_id: string; p_amount_minor: number }
        Returns: {
          archived_at: string | null
          bank_type: string | null
          created_at: string
          currency: string
          id: string
          institution: string | null
          kind: string
          last4: string | null
          name: string
          opening_balance_date: string
          opening_balance_minor: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_category_budget: {
        Args: {
          p_amount_minor: number
          p_category_id: string
          p_effective_from: string
        }
        Returns: {
          amount_minor: number
          category_id: string
          created_at: string
          currency: string
          effective_from: string
          id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "budgets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_loan_archived: {
        Args: { p_archived: boolean; p_loan_id: string }
        Returns: {
          account_id: string
          archived_at: string | null
          capitalised_minor: number
          card_id: string | null
          created_at: string
          currency: string
          disbursed_minor: number
          emi_estimate_minor: number
          emi_minor: number
          first_due_date: string
          id: string
          idempotency_key: string
          instalment_months: number
          lender: string
          loan_type: string
          moratorium_interest: string | null
          moratorium_months: number
          nickname: string | null
          opening_outstanding_minor: number
          rate_bps: number
          rate_kind: string
          sanctioned_minor: number
          start_mode: string
          tenure_months: number
          tracking_started_on: string
          type_other: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_recurring_rule_archived: {
        Args: { p_archived: boolean; p_rule_id: string }
        Returns: {
          account_id: string
          amount_minor: number
          archived_at: string | null
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          end_date: string | null
          frequency: string
          id: string
          idempotency_key: string
          note: string | null
          payment_mode: string | null
          start_date: string
          type: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      skip_recurring_occurrence: {
        Args: {
          p_idempotency_key: string
          p_occurrence_date: string
          p_reason?: string
          p_rule_id: string
        }
        Returns: {
          created_at: string
          id: string
          idempotency_key: string
          occurrence_date: string
          reason: string | null
          rule_id: string
          undone_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_skips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transaction_summary: {
        Args: {
          p_account_id?: string
          p_amount_minor?: number
          p_category_id?: string
          p_from: string
          p_query?: string
          p_to: string
        }
        Returns: {
          currency: string
          expense_count: number
          expense_minor: number
          income_count: number
          income_minor: number
          transfer_count: number
        }[]
      }
      transactions_matching: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_category_id: string
          p_from: string
          p_query: string
          p_to: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      undo_recurring_skip: {
        Args: { p_occurrence_date: string; p_rule_id: string }
        Returns: {
          created_at: string
          id: string
          idempotency_key: string
          occurrence_date: string
          reason: string | null
          rule_id: string
          undone_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_skips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_borrowing: {
        Args: {
          p_borrowing_id: string
          p_lender: string
          p_reason?: string
          p_relationship: string
        }
        Returns: {
          account_id: string
          archived_at: string | null
          borrowed_minor: number
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          amount_to_return_minor: number
          instalment_count: number | null
          lender: string
          reason: string | null
          receipt_transaction_id: string | null
          relationship: string | null
          repay_from_account_id: string | null
          return_on: string | null
          return_plan: string | null
          received_on: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "borrowings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_card: {
        Args: {
          p_card_id: string
          p_due_day: number
          p_issuer: string
          p_limit_minor: number
          p_nickname?: string
          p_product?: string
          p_product_other?: boolean
          p_statement_day: number
        }
        Returns: {
          account_id: string
          archived_at: string | null
          created_at: string
          currency: string
          due_day: number
          id: string
          idempotency_key: string
          issuer: string
          limit_minor: number
          nickname: string | null
          opening_owed_minor: number
          product: string | null
          product_other: boolean
          statement_day: number
          tracking_started_on: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_cards"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_loan: {
        Args: {
          p_emi_minor: number
          p_lender: string
          p_loan_id: string
          p_loan_type: string
          p_nickname?: string
          p_rate_bps: number
          p_rate_kind: string
          p_sanctioned_minor: number
          p_type_other?: string
        }
        Returns: {
          account_id: string
          archived_at: string | null
          capitalised_minor: number
          card_id: string | null
          created_at: string
          currency: string
          disbursed_minor: number
          emi_estimate_minor: number
          emi_minor: number
          first_due_date: string
          id: string
          idempotency_key: string
          instalment_months: number
          lender: string
          loan_type: string
          moratorium_interest: string | null
          moratorium_months: number
          nickname: string | null
          opening_outstanding_minor: number
          rate_bps: number
          rate_kind: string
          sanctioned_minor: number
          start_mode: string
          tenure_months: number
          tracking_started_on: string
          type_other: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_recurring_rule: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_category_id?: string
          p_counter_account_id?: string
          p_end_date?: string
          p_note?: string
          p_payment_mode?: string
          p_rule_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          archived_at: string | null
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          end_date: string | null
          frequency: string
          id: string
          idempotency_key: string
          note: string | null
          payment_mode: string | null
          start_date: string
          type: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_local_today: { Args: { p_user_id: string }; Returns: string }
      void_due_payment: {
        Args: {
          p_idempotency_key: string
          p_payment_id: string
          p_reason?: string
        }
        Returns: {
          account_id: string
          capitalised_minor: number
          created_at: string
          due_item_id: string
          fees_minor: number
          id: string
          idempotency_key: string
          interest_minor: number
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "due_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_liability_payment: {
        Args: {
          p_idempotency_key: string
          p_payment_id: string
          p_reason?: string
        }
        Returns: {
          account_id: string
          created_at: string
          id: string
          idempotency_key: string
          interest_minor: number
          liability_account_id: string
          paid_on: string
          principal_minor: number
          replaces_id: string | null
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "liability_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_transaction: {
        Args: {
          p_idempotency_key: string
          p_reason?: string
          p_transaction_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          category_id: string | null
          counter_account_id: string | null
          created_at: string
          currency: string
          due_payment_id: string | null
          id: string
          idempotency_key: string
          liability_payment_id: string | null
          note: string | null
          occurred_on: string
          occurrence_date: string | null
          payment_mode: string | null
          recurring_rule_id: string | null
          replaces_id: string | null
          type: string
          user_id: string
          void_idempotency_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
