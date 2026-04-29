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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
        }
        Relationships: []
      }
      appointment_manage_tokens: {
        Row: {
          appointment_id: string
          created_at: string
          expires_at: string
          id: string
          patient_phone: string
          token: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          expires_at: string
          id?: string
          patient_phone: string
          token: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          patient_phone?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_manage_tokens_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          cancel_reason: Database["public"]["Enums"]["cancel_reason"] | null
          created_at: string
          created_by_user_id: string | null
          created_from_session_id: string | null
          doctor_id: string
          doctor_notes: string | null
          doctor_notes_updated_at: string | null
          end_at: string
          google_event_id: string | null
          id: string
          office_id: string | null
          outlook_event_id: string | null
          patient_id: string
          start_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          symptoms: string | null
          updated_at: string
        }
        Insert: {
          booking_source?: Database["public"]["Enums"]["booking_source"]
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null
          created_at?: string
          created_by_user_id?: string | null
          created_from_session_id?: string | null
          doctor_id: string
          doctor_notes?: string | null
          doctor_notes_updated_at?: string | null
          end_at: string
          google_event_id?: string | null
          id?: string
          office_id?: string | null
          outlook_event_id?: string | null
          patient_id: string
          start_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          symptoms?: string | null
          updated_at?: string
        }
        Update: {
          booking_source?: Database["public"]["Enums"]["booking_source"]
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null
          created_at?: string
          created_by_user_id?: string | null
          created_from_session_id?: string | null
          doctor_id?: string
          doctor_notes?: string | null
          doctor_notes_updated_at?: string | null
          end_at?: string
          google_event_id?: string | null
          id?: string
          office_id?: string | null
          outlook_event_id?: string | null
          patient_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          symptoms?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_created_from_session_id_fkey"
            columns: ["created_from_session_id"]
            isOneToOne: false
            referencedRelation: "reservation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      doctor_date_overrides: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          is_available: boolean
          note: string | null
          override_date: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          is_available?: boolean
          note?: string | null
          override_date: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          is_available?: boolean
          note?: string | null
          override_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_date_overrides_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_schedule_settings: {
        Row: {
          appointment_duration_minutes: number
          doctor_id: string
          min_confirm_hours_before: number
          timezone: string
          updated_at: string
        }
        Insert: {
          appointment_duration_minutes?: number
          doctor_id: string
          min_confirm_hours_before?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          appointment_duration_minutes?: number
          doctor_id?: string
          min_confirm_hours_before?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_schedule_settings_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: true
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_specialties: {
        Row: {
          doctor_id: string
          specialty_id: string
        }
        Insert: {
          doctor_id: string
          specialty_id: string
        }
        Update: {
          doctor_id?: string
          specialty_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_specialties_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_specialties_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_offices: {
        Row: {
          address: string | null
          appointment_duration_minutes: number
          city_id: string | null
          created_at: string
          display_color: string
          doctor_id: string
          google_calendar_connected: boolean
          google_calendar_id: string | null
          google_refresh_token_ref: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          name: string
          outlook_calendar_connected: boolean
          outlook_calendar_id: string | null
          outlook_refresh_token_ref: string | null
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          appointment_duration_minutes?: number
          city_id?: string | null
          created_at?: string
          display_color?: string
          doctor_id: string
          google_calendar_connected?: boolean
          google_calendar_id?: string | null
          google_refresh_token_ref?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          name: string
          outlook_calendar_connected?: boolean
          outlook_calendar_id?: string | null
          outlook_refresh_token_ref?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          appointment_duration_minutes?: number
          city_id?: string | null
          created_at?: string
          display_color?: string
          doctor_id?: string
          google_calendar_connected?: boolean
          google_calendar_id?: string | null
          google_refresh_token_ref?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          outlook_calendar_connected?: boolean
          outlook_calendar_id?: string | null
          outlook_refresh_token_ref?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_offices_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_offices_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_offices_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_weekly_availability: {
        Row: {
          doctor_id: string
          end_time: string
          id: string
          is_enabled: boolean
          office_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          doctor_id: string
          end_time: string
          id?: string
          is_enabled?: boolean
          office_id: string
          start_time: string
          weekday: number
        }
        Update: {
          doctor_id?: string
          end_time?: string
          id?: string
          is_enabled?: boolean
          office_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_weekly_availability_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          address: string | null
          city_id: string | null
          created_at: string
          full_name: string
          google_calendar_connected: boolean
          google_calendar_id: string | null
          google_refresh_token_ref: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          outlook_calendar_connected: boolean
          outlook_calendar_id: string | null
          outlook_refresh_token_ref: string | null
          phone: string | null
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          city_id?: string | null
          created_at?: string
          full_name: string
          google_calendar_connected?: boolean
          google_calendar_id?: string | null
          google_refresh_token_ref?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          outlook_calendar_connected?: boolean
          outlook_calendar_id?: string | null
          outlook_refresh_token_ref?: string | null
          phone?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          city_id?: string | null
          created_at?: string
          full_name?: string
          google_calendar_connected?: boolean
          google_calendar_id?: string | null
          google_refresh_token_ref?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          outlook_calendar_connected?: boolean
          outlook_calendar_id?: string | null
          outlook_refresh_token_ref?: string | null
          phone?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctors_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      hospitals: {
        Row: {
          address: string | null
          city_id: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          city_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          city_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hospitals_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospitals_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      laboratories: {
        Row: {
          address: string | null
          city_id: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          city_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          city_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "laboratories_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "laboratories_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          appointment_id: string | null
          body: string | null
          created_at: string
          doctor_id: string | null
          id: string
          is_read: boolean
          recipient_role: Database["public"]["Enums"]["app_role"]
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          appointment_id?: string | null
          body?: string | null
          created_at?: string
          doctor_id?: string | null
          id?: string
          is_read?: boolean
          recipient_role: Database["public"]["Enums"]["app_role"]
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          appointment_id?: string | null
          body?: string | null
          created_at?: string
          doctor_id?: string | null
          id?: string
          is_read?: boolean
          recipient_role?: Database["public"]["Enums"]["app_role"]
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          phone: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string
        }
        Relationships: []
      }
      post_consultation_forms: {
        Row: {
          appointment_id: string
          created_at: string
          doctor_id: string
          hospitalization: string | null
          id: string
          imaging_studies: string | null
          lab_tests: string | null
          observations: string | null
          prescribed_medications: string | null
          report_destination_id: string | null
          report_destination_type: string | null
          report_sent_at: string | null
          review_status: Database["public"]["Enums"]["post_consultation_status"]
          specialist_referral: string | null
        }
        Insert: {
          appointment_id: string
          created_at?: string
          doctor_id: string
          hospitalization?: string | null
          id?: string
          imaging_studies?: string | null
          lab_tests?: string | null
          observations?: string | null
          prescribed_medications?: string | null
          report_destination_id?: string | null
          report_destination_type?: string | null
          report_sent_at?: string | null
          review_status?: Database["public"]["Enums"]["post_consultation_status"]
          specialist_referral?: string | null
        }
        Update: {
          appointment_id?: string
          created_at?: string
          doctor_id?: string
          hospitalization?: string | null
          id?: string
          imaging_studies?: string | null
          lab_tests?: string | null
          observations?: string | null
          prescribed_medications?: string | null
          report_destination_id?: string | null
          report_destination_type?: string | null
          report_sent_at?: string | null
          review_status?: Database["public"]["Enums"]["post_consultation_status"]
          specialist_referral?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_consultation_forms_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_consultation_forms_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_sessions: {
        Row: {
          created_at: string
          doctor_id: string
          expires_at: string
          id: string
          office_id: string | null
          patient_id: string
          symptoms: string | null
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          doctor_id: string
          expires_at: string
          id?: string
          office_id?: string | null
          patient_id: string
          symptoms?: string | null
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          doctor_id?: string
          expires_at?: string
          id?: string
          office_id?: string | null
          patient_id?: string
          symptoms?: string | null
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_sessions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      specialties: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          doctor_id: string | null
          email: string | null
          id: string
          initial_password: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          doctor_id?: string | null
          email?: string | null
          id: string
          initial_password?: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          doctor_id?: string | null
          email?: string | null
          id?: string
          initial_password?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "users_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          description: string | null
          events: string[]
          id: string
          is_active: boolean
          name: string
          payload_overrides: Json | null
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          name: string
          payload_overrides?: Json | null
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          name?: string
          payload_overrides?: Json | null
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      zones: {
        Row: {
          city_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          city_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          city_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_doctor_id_for_user: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_superadmin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "superadmin" | "admin" | "doctor"
      appointment_status: "scheduled" | "confirmed" | "cancelled" | "completed"
      booking_source: "patient_self" | "admin_manual" | "doctor_manual"
      cancel_reason: "patient" | "doctor" | "no_confirmation" | "admin"
      notification_type:
        | "appointment_scheduled"
        | "appointment_cancelled_by_patient"
        | "appointment_cancelled_by_doctor"
        | "appointment_auto_cancelled"
        | "appointment_completed"
        | "postconsultation_submitted"
        | "appointment_rescheduled"
        | "appointment_cancelled_by_admin"
      post_consultation_status: "pending" | "read" | "report_sent"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["superadmin", "admin", "doctor"],
      appointment_status: ["scheduled", "confirmed", "cancelled", "completed"],
      booking_source: ["patient_self", "admin_manual", "doctor_manual"],
      cancel_reason: ["patient", "doctor", "no_confirmation", "admin"],
      notification_type: [
        "appointment_scheduled",
        "appointment_cancelled_by_patient",
        "appointment_cancelled_by_doctor",
        "appointment_auto_cancelled",
        "appointment_completed",
        "postconsultation_submitted",
        "appointment_rescheduled",
        "appointment_cancelled_by_admin",
      ],
      post_consultation_status: ["pending", "read", "report_sent"],
    },
  },
} as const
