/**
 * 数据库类型 —— 与 supabase/migrations/0001_init.sql 严格对齐
 * 本文件由后端 SQL 决定。生产环境建议用 `supabase gen types typescript` 生成后替换。
 */
export type AccountType = '1_public' | '2_cash' | '3_export'
export type AccountStatus = 'active' | 'inactive'
export type UserRole = 'admin' | 'checker' | 'warehouse' | 'finance' | 'customer' | 'fin_customer'

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
          color_code: string | null
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
          color_code?: string | null
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
      order_attachments: {
        Row: {
          id: string
          order_id: string
          account_id: string
          storage_path: string
          mime: string
          size_bytes: number
          caption: string | null
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          order_id: string
          account_id: string
          storage_path: string
          mime: string
          size_bytes: number
          caption?: string | null
          uploaded_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['order_attachments']['Row']>
      }
      chat_conversations: {
        Row: {
          id: string
          account_id: string
          subject_order_id: string | null
          assigned_to: string | null
          status: 'open' | 'closed' | 'archived'
          last_message_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          account_id: string
          subject_order_id?: string | null
          assigned_to?: string | null
          status?: 'open' | 'closed' | 'archived'
        }
        Update: Partial<Database['public']['Tables']['chat_conversations']['Row']>
      }
      chat_conversation_members: {
        Row: {
          id: string
          conversation_id: string
          user_id: string
          member_type: 'customer' | 'staff'
          last_read_message_id: string | null
          last_read_at: string | null
          joined_at: string
          left_at: string | null
        }
        Insert: {
          conversation_id: string
          user_id: string
          member_type: 'customer' | 'staff'
          last_read_message_id?: string | null
          last_read_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['chat_conversation_members']['Row']>
      }
      chat_presence: {
        Row: {
          user_id: string
          device_id: string
          status: 'online' | 'away' | 'offline'
          last_seen_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          device_id?: string
          status?: 'online' | 'away' | 'offline'
        }
        Update: Partial<Database['public']['Tables']['chat_presence']['Row']>
      }
      // M1: per-user message read punct
      chat_message_recipients: {
        Row: {
          id: string
          message_id: string
          user_id: string
          read_at: string
        }
        Insert: {
          message_id: string
          user_id: string
        }
        Update: Partial<Database['public']['Tables']['chat_message_recipients']['Row']>
      }
      chat_messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          message_type: 'text' | 'system'
          message_kind: 'text' | 'image' | 'order_card'
          body: string
          client_message_id: string
          reply_to_id: string | null
          created_at: string
          edited_at: string | null
          deleted_at: string | null
        }
        Insert: {
          conversation_id: string
          sender_id: string
          message_type?: 'text' | 'system'
          message_kind?: 'text' | 'image' | 'order_card'
          body: string
          client_message_id: string
          reply_to_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['chat_messages']['Row']>
      }
      chat_message_attachments: {
        Row: {
          id: string
          message_id: string
          storage_path: string
          mime: string
          size_bytes: number
          width: number | null
          height: number | null
          created_at: string
        }
        Insert: {
          message_id: string
          storage_path: string
          mime: string
          size_bytes: number
          width?: number | null
          height?: number | null
        }
        Update: Partial<Database['public']['Tables']['chat_message_attachments']['Row']>
      }
      chat_message_metadata: {
        Row: {
          message_id: string
          payload: Record<string, any>
          updated_at: string
        }
        Insert: {
          message_id: string
          payload?: Record<string, any>
        }
        Update: Partial<Database['public']['Tables']['chat_message_metadata']['Row']>
      }
      chat_typing: {
        Row: {
          conversation_id: string
          user_id: string
          started_at: string
          expires_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          expires_at?: string
        }
        Update: Partial<Database['public']['Tables']['chat_typing']['Row']>
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          kind: 'chat_message' | 'order_status' | 'staff_assigned' | 'staff_transferred' | 'system'
          title: string
          body: string
          link: string | null
          payload: Record<string, any>
          read_at: string | null
          created_at: string
        }
        Insert: {
          user_id: string
          kind: 'chat_message' | 'order_status' | 'staff_assigned' | 'staff_transferred' | 'system'
          title: string
          body?: string
          link?: string | null
          payload?: Record<string, any>
        }
        Update: Partial<Database['public']['Tables']['notifications']['Row']>
      }
    }
    Functions: {
      rpc_chat_admin_list_conversations: {
        Args: { p_status?: string | null; p_limit?: number; p_offset?: number }
        Returns: Array<{
          id: string
          account_id: string
          subject_order_id: string | null
          assigned_to: string | null
          status: 'open' | 'closed' | 'archived'
          last_message_at: string | null
          created_at: string
          updated_at: string
          account_name: string | null
          company_name: string | null
          order_no: string | null
          assigned_name: string | null
          last_message_body: string | null
          last_message_sender: string | null
          last_message_at_actual: string | null
          unread_for_me: number
        }>
      }
      rpc_chat_create_image_message: {
        Args: {
          p_conversation: string
          p_storage_path: string
          p_mime: string
          p_size: number
          p_width?: number | null
          p_height?: number | null
          p_client_message_id?: string | null
        }
        Returns: Array<{ message_id: string; attachment_id: string; created: boolean }>
      }
      rpc_chat_create_order_card_message: {
        Args: {
          p_conversation: string
          p_order_id: string
          p_client_message_id?: string | null
        }
        Returns: Array<{ message_id: string; created: boolean }>
      }
      rpc_chat_mark_read: {
        Args: { p_conversation: string; p_message_id: string }
        Returns: void
      }
      rpc_chat_search_messages: {
        Args: { p_keyword: string; p_account_id?: string | null; p_limit?: number }
        Returns: Array<{
          message_id: string
          conversation_id: string
          sender_id: string
          sender_name: string | null
          body: string
          message_kind: 'text' | 'image' | 'order_card'
          created_at: string
          account_id: string
          account_name: string | null
          order_no: string | null
        }>
      }
      rpc_chat_edit_message: {
        Args: { p_message_id: string; p_new_body: string }
        Returns: Array<{ message_id: string; edited_at: string }>
      }
      rpc_chat_soft_delete_message: {
        Args: { p_message_id: string }
        Returns: void
      }
      rpc_chat_join_conversation: {
        Args: { p_conversation: string }
        Returns: void
      }
      rpc_chat_transfer_conversation: {
        Args: { p_conversation: string; p_to_staff_id: string | null }
        Returns: void
      }
      rpc_chat_post_system_message: {
        Args: { p_conversation: string; p_body: string; p_meta?: Record<string, any> | null }
        Returns: string
      }
      rpc_notifications_list: {
        Args: { p_limit?: number; p_only_unread?: boolean }
        Returns: Array<{
          id: string
          kind: string
          title: string
          body: string
          link: string | null
          payload: Record<string, any>
          read_at: string | null
          created_at: string
        }>
      }
      rpc_notifications_unread_count: {
        Args: Record<string, never>
        Returns: number
      }
      rpc_notifications_mark_read: {
        Args: { p_id: string }
        Returns: void
      }
      rpc_notifications_mark_all_read: {
        Args: Record<string, never>
        Returns: number
      }
    }
  }
}
