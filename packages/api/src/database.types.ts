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
          id: string
          idempotency_key: string
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
          id?: string
          idempotency_key: string
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
          id?: string
          idempotency_key?: string
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
          id: string
          idempotency_key: string
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
          id: string
          idempotency_key: string
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
          id: string
          idempotency_key: string
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
          id: string
          idempotency_key: string
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
          id: string
          idempotency_key: string
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
          id: string
          idempotency_key: string
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
          id: string
          idempotency_key: string
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
