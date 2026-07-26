/**
 * 数据库类型 —— 与 supabase/migrations/0001_init.sql 严格对齐
 * 本文件由后端 SQL 决定。生产环境建议用 `supabase gen types typescript` 生成后替换。
 */
export type AccountType = '1_public' | '2_cash' | '3_export'
export type AccountStatus = 'active' | 'inactive'
export type UserRole = 'admin' | 'checker' | 'warehouse' | 'finance' | 'customer'

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          parent_id: string | null
          account_type: AccountType
          account_name: string
          company_name: string
          address: string
          bank: string
          bank_account: string
          mfo: string
          inn: string
          director: string
          contract_no: string | null
          contract_date: string | null
          balance: number
          status: AccountStatus
          is_main: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['accounts']['Row']> & {
          account_type: AccountType
          account_name: string
          company_name: string
          address: string
          bank: string
          bank_account: string
          mfo: string
          inn: string
          director: string
        }
        Update: Partial<Database['public']['Tables']['accounts']['Row']>
      }
      users: {
        Row: {
          id: string
          account_id: string
          role: UserRole
          is_main: boolean
          full_name: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          account_id: string
          role: UserRole
          is_main?: boolean
          full_name?: string | null
          phone?: string | null
        }
        Update: Partial<Database['public']['Tables']['users']['Row']>
      }
      products: {
        Row: {
          id: string
          model: string
          category: string
          conversion_rate: number
          remark: string | null
          image_url: string | null
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          model: string
          category: string
          conversion_rate: number
          remark?: string | null
          image_url?: string | null
          display_order?: number
        }
        Update: Partial<Database['public']['Tables']['products']['Row']>
      }
      account_products: {
        Row: {
          account_id: string
          product_id: string
          is_visible: boolean
          stock_level_1: number
          stock_level_2: number
          updated_at: string
        }
        Insert: {
          account_id: string
          product_id: string
          is_visible?: boolean
          stock_level_1?: number
          stock_level_2?: number
        }
        Update: Partial<Database['public']['Tables']['account_products']['Row']>
      }
      stock_colors: {
        Row: {
          id: string
          product_id: string
          color_code: string
          stock_level: number
          boxes: number
          created_at: string
          updated_at: string
        }
        Insert: {
          product_id: string
          color_code: string
          stock_level: number
          boxes?: number
        }
        Update: Partial<Database['public']['Tables']['stock_colors']['Row']>
      }
      customer_group_mappings: {
        Row: {
          id: string
          customer_group: string
          account_id: string
          is_active: boolean
          remark: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          customer_group: string
          account_id: string
          is_active?: boolean
          remark?: string | null
        }
        Update: Partial<Database['public']['Tables']['customer_group_mappings']['Row']>
      }
      orders: {
        Row: {
          id: string
          order_no: string
          account_id: string
          sub_account_id: string | null
          created_by: string | null
          audited_by: string | null
          accounted_by: string | null
          shipped_by: string | null
          status: 'pending' | 'audited' | 'accounted' | 'shipped' | 'cancelled'
          remark: string | null
          created_at: string
          audited_at: string | null
          accounted_at: string | null
          shipped_at: string | null
          updated_at: string
        }
        Insert: {
          order_no: string
          account_id: string
          sub_account_id?: string | null
          created_by?: string | null
          status?: 'pending' | 'audited' | 'accounted' | 'shipped' | 'cancelled'
          remark?: string | null
        }
        Update: Partial<Database['public']['Tables']['orders']['Row']>
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          boxes: number
          m2_per_box: number
          m2_total: number
          unit_price: number | null
          line_total: number
          stock_level: 1 | 2
          remark: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          order_id: string
          product_id: string
          boxes: number
          m2_per_box: number
          stock_level?: 1 | 2
          unit_price?: number | null
          remark?: string | null
        }
        Update: Partial<Database['public']['Tables']['order_items']['Row']>
      }
      finance_ledger: {
        Row: {
          id: string
          order_id: string
          account_id: string
          direction: 'debit' | 'credit'
          amount: number
          currency: string
          memo: string | null
          recorded_by: string | null
          recorded_at: string
        }
        Insert: {
          order_id: string
          account_id: string
          direction: 'debit' | 'credit'
          amount: number
          currency?: string
          memo?: string | null
          recorded_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['finance_ledger']['Row']>
      }
      order_status_log: {
        Row: {
          id: string
          order_id: string
          from_status: string | null
          to_status: string
          changed_by: string | null
          changed_at: string
          note: string | null
        }
        Insert: {
          order_id: string
          from_status?: string | null
          to_status: string
          changed_by?: string | null
          note?: string | null
        }
        Update: Partial<Database['public']['Tables']['order_status_log']['Row']>
      }
    }
  }
}
