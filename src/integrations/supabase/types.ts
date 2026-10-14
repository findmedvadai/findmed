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
    PostgrestVersion: "14.5"
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
          documents_received_at: string | null
          documents_requested_at: string | null
          end_at: string
          google_event_id: string | null
          id: string
          office_id: string | null
          outlook_event_id: string | null
          patient_id: string
          reminder_48h_sent_at: string | null
          reminder_day_of_sent_at: string | null
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
          documents_received_at?: string | null
          documents_requested_at?: string | null
          end_at: string
          google_event_id?: string | null
          id?: string
          office_id?: string | null
          outlook_event_id?: string | null
          patient_id: string
          reminder_48h_sent_at?: string | null
          reminder_day_of_sent_at?: string | null
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
          documents_received_at?: string | null
          documents_requested_at?: string | null
          end_at?: string
          google_event_id?: string | null
          id?: string
          office_id?: string | null
          outlook_event_id?: string | null
          patient_id?: string
          reminder_48h_sent_at?: string | null
          reminder_day_of_sent_at?: string | null
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
            foreignKeyName: "appointments_office_fk"
            columns: ["doctor_id", "office_id"]
            isOneToOne: false
            referencedRelation: "doctor_offices"
            referencedColumns: ["doctor_id", "id"]
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
      calendar_connection_events: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          connected_at: string | null
          doctor_id: string | null
          event_type: string
          http_status: number | null
          id: string
          lifetime_seconds: number | null
          occurred_at: string
          office_id: string
          provider: string
          provider_response: Json | null
          reason_code: string | null
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          connected_at?: string | null
          doctor_id?: string | null
          event_type: string
          http_status?: number | null
          id?: string
          lifetime_seconds?: number | null
          occurred_at?: string
          office_id: string
          provider: string
          provider_response?: Json | null
          reason_code?: string | null
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          connected_at?: string | null
          doctor_id?: string | null
          event_type?: string
          http_status?: number | null
          id?: string
          lifetime_seconds?: number | null
          occurred_at?: string
          office_id?: string
          provider?: string
          provider_response?: Json | null
          reason_code?: string | null
        }
        Relationships: []
      }
      case_alerts: {
        Row: {
          attempts: number
          case_id: string
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          level: number
          locked_until: string | null
          next_attempt_at: string
          notification_id: string | null
          priority: string
          processed_at: string | null
          updated_at: string
          whatsapp_detail: string | null
          whatsapp_status: string
        }
        Insert: {
          attempts?: number
          case_id: string
          created_at?: string
          dedupe_key: string
          id?: string
          kind: string
          level?: number
          locked_until?: string | null
          next_attempt_at?: string
          notification_id?: string | null
          priority: string
          processed_at?: string | null
          updated_at?: string
          whatsapp_detail?: string | null
          whatsapp_status?: string
        }
        Update: {
          attempts?: number
          case_id?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          kind?: string
          level?: number
          locked_until?: string | null
          next_attempt_at?: string
          notification_id?: string | null
          priority?: string
          processed_at?: string | null
          updated_at?: string
          whatsapp_detail?: string | null
          whatsapp_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_alerts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "patient_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_alerts_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      case_events: {
        Row: {
          actor: string
          actor_user_id: string | null
          case_id: string
          created_at: string
          detail: Json
          event_type: string
          id: string
        }
        Insert: {
          actor: string
          actor_user_id?: string | null
          case_id: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
        }
        Update: {
          actor?: string
          actor_user_id?: string | null
          case_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "patient_cases"
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
          google_calendar_name: string | null
          google_connected_at: string | null
          google_refresh_token_ref: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          name: string
          outlook_calendar_connected: boolean
          outlook_calendar_id: string | null
          outlook_calendar_name: string | null
          outlook_connected_at: string | null
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
          google_calendar_name?: string | null
          google_connected_at?: string | null
          google_refresh_token_ref?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          name: string
          outlook_calendar_connected?: boolean
          outlook_calendar_id?: string | null
          outlook_calendar_name?: string | null
          outlook_connected_at?: string | null
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
          google_calendar_name?: string | null
          google_connected_at?: string | null
          google_refresh_token_ref?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          outlook_calendar_connected?: boolean
          outlook_calendar_id?: string | null
          outlook_calendar_name?: string | null
          outlook_connected_at?: string | null
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
          {
            foreignKeyName: "doctor_weekly_availability_office_fk"
            columns: ["doctor_id", "office_id"]
            isOneToOne: false
            referencedRelation: "doctor_offices"
            referencedColumns: ["doctor_id", "id"]
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
      domain_outbox: {
        Row: {
          aggregate_id: string | null
          attempts: number
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          last_error: string | null
          locked_until: string | null
          next_attempt_at: string
          payload: Json
          processed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aggregate_id?: string | null
          attempts?: number
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          payload: Json
          processed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aggregate_id?: string | null
          attempts?: number
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
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
      mcp_requests: {
        Row: {
          arguments: Json | null
          client: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          kind: string
          method: string | null
          ok: boolean
          result: Json | null
          status: string | null
          subject_phone: string | null
          tool_name: string | null
          trace_id: string | null
        }
        Insert: {
          arguments?: Json | null
          client?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind: string
          method?: string | null
          ok: boolean
          result?: Json | null
          status?: string | null
          subject_phone?: string | null
          tool_name?: string | null
          trace_id?: string | null
        }
        Update: {
          arguments?: Json | null
          client?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          method?: string | null
          ok?: boolean
          result?: Json | null
          status?: string | null
          subject_phone?: string | null
          tool_name?: string | null
          trace_id?: string | null
        }
        Relationships: []
      }
      message_deliveries: {
        Row: {
          appointment_id: string | null
          attempts: number
          case_alert_id: string | null
          case_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          language: string
          outbox_id: string | null
          request: Json | null
          sent_by: string | null
          source: string
          staff_recipient_id: string | null
          status: string
          step_position: number | null
          template_name: string
          to_phone: string
          updated_at: string
          wamid: string | null
          whaapy_message_id: string | null
        }
        Insert: {
          appointment_id?: string | null
          attempts?: number
          case_alert_id?: string | null
          case_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          language?: string
          outbox_id?: string | null
          request?: Json | null
          sent_by?: string | null
          source?: string
          staff_recipient_id?: string | null
          status?: string
          step_position?: number | null
          template_name: string
          to_phone: string
          updated_at?: string
          wamid?: string | null
          whaapy_message_id?: string | null
        }
        Update: {
          appointment_id?: string | null
          attempts?: number
          case_alert_id?: string | null
          case_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          language?: string
          outbox_id?: string | null
          request?: Json | null
          sent_by?: string | null
          source?: string
          staff_recipient_id?: string | null
          status?: string
          step_position?: number | null
          template_name?: string
          to_phone?: string
          updated_at?: string
          wamid?: string | null
          whaapy_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_deliveries_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_deliveries_case_alert_id_fkey"
            columns: ["case_alert_id"]
            isOneToOne: false
            referencedRelation: "case_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_deliveries_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "patient_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_deliveries_staff_recipient_id_fkey"
            columns: ["staff_recipient_id"]
            isOneToOne: false
            referencedRelation: "staff_alert_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_deliveries_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "domain_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      message_route_steps: {
        Row: {
          body_params: string[]
          created_at: string
          enabled: boolean
          event_type: string
          id: string
          language: string
          position: number
          quick_reply_action: string | null
          skip_on_reschedule: boolean
          template_name: string
          updated_at: string
          url_button_param: string | null
          when_cancel_reason: string | null
          when_status: string | null
        }
        Insert: {
          body_params?: string[]
          created_at?: string
          enabled?: boolean
          event_type: string
          id?: string
          language?: string
          position: number
          quick_reply_action?: string | null
          skip_on_reschedule?: boolean
          template_name: string
          updated_at?: string
          url_button_param?: string | null
          when_cancel_reason?: string | null
          when_status?: string | null
        }
        Update: {
          body_params?: string[]
          created_at?: string
          enabled?: boolean
          event_type?: string
          id?: string
          language?: string
          position?: number
          quick_reply_action?: string | null
          skip_on_reschedule?: boolean
          template_name?: string
          updated_at?: string
          url_button_param?: string | null
          when_cancel_reason?: string | null
          when_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_route_steps_event_type_fkey"
            columns: ["event_type"]
            isOneToOne: false
            referencedRelation: "message_routes"
            referencedColumns: ["event_type"]
          },
        ]
      }
      message_routes: {
        Row: {
          created_at: string
          description: string | null
          event_type: string
          owner: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_type: string
          owner?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          event_type?: string
          owner?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          appointment_id: string | null
          body: string | null
          case_id: string | null
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
          case_id?: string | null
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
          case_id?: string | null
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
            foreignKeyName: "notifications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "patient_cases"
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
      operation_requests: {
        Row: {
          action: string
          appointment_id: string
          channel: string
          confirmation_evidence: Json | null
          created_at: string
          expires_at: string
          id: string
          payload_hash: string
          result: Json | null
          status: string
          subject_phone: string
          updated_at: string
        }
        Insert: {
          action: string
          appointment_id: string
          channel: string
          confirmation_evidence?: Json | null
          created_at?: string
          expires_at: string
          id?: string
          payload_hash: string
          result?: Json | null
          status?: string
          subject_phone: string
          updated_at?: string
        }
        Update: {
          action?: string
          appointment_id?: string
          channel?: string
          confirmation_evidence?: Json | null
          created_at?: string
          expires_at?: string
          id?: string
          payload_hash?: string
          result?: Json | null
          status?: string
          subject_phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_requests_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_cases: {
        Row: {
          ai_state: string
          alert_level: number
          appointment_id: string | null
          assigned_at: string | null
          assigned_user_id: string | null
          city: string | null
          contact_name: string | null
          created_at: string
          due_at: string | null
          handoff_reason: string | null
          handoff_requested_at: string | null
          id: string
          last_alert_at: string | null
          next_action: string | null
          patient_id: string | null
          priority: string
          request_type: string
          resolution_reason: string | null
          resolved_at: string | null
          source: string
          status: string
          subject_phone: string
          summary: string
          updated_at: string
          whaapy_assignment: string
          whaapy_contact_id: string | null
          whaapy_conversation_id: string | null
          zone: string | null
        }
        Insert: {
          ai_state?: string
          alert_level?: number
          appointment_id?: string | null
          assigned_at?: string | null
          assigned_user_id?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          due_at?: string | null
          handoff_reason?: string | null
          handoff_requested_at?: string | null
          id?: string
          last_alert_at?: string | null
          next_action?: string | null
          patient_id?: string | null
          priority?: string
          request_type: string
          resolution_reason?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject_phone: string
          summary: string
          updated_at?: string
          whaapy_assignment?: string
          whaapy_contact_id?: string | null
          whaapy_conversation_id?: string | null
          zone?: string | null
        }
        Update: {
          ai_state?: string
          alert_level?: number
          appointment_id?: string | null
          assigned_at?: string | null
          assigned_user_id?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          due_at?: string | null
          handoff_reason?: string | null
          handoff_requested_at?: string | null
          id?: string
          last_alert_at?: string | null
          next_action?: string | null
          patient_id?: string | null
          priority?: string
          request_type?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject_phone?: string
          summary?: string
          updated_at?: string
          whaapy_assignment?: string
          whaapy_contact_id?: string | null
          whaapy_conversation_id?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_cases_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_cases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          created_at: string
          full_name: string
          has_insurance: boolean | null
          id: string
          insurance_updated_at: string | null
          insurer: string | null
          phone: string
          policy_number: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          has_insurance?: boolean | null
          id?: string
          insurance_updated_at?: string | null
          insurer?: string | null
          phone: string
          policy_number?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          has_insurance?: boolean | null
          id?: string
          insurance_updated_at?: string | null
          insurer?: string | null
          phone?: string
          policy_number?: string | null
        }
        Relationships: []
      }
      post_consultation_case_links: {
        Row: {
          case_id: string
          created_at: string
          form_id: string
          outcome: string
          request_type: string
        }
        Insert: {
          case_id: string
          created_at?: string
          form_id: string
          outcome: string
          request_type: string
        }
        Update: {
          case_id?: string
          created_at?: string
          form_id?: string
          outcome?: string
          request_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_consultation_case_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "patient_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_consultation_case_links_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "post_consultation_forms"
            referencedColumns: ["id"]
          },
        ]
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
          management_type: string | null
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
          management_type?: string | null
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
          management_type?: string | null
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
      reimbursements: {
        Row: {
          amount: number | null
          appointment_id: string | null
          case_id: string
          created_at: string
          created_by_user_id: string | null
          currency: string
          id: string
          insurer: string
          invoice_number: string | null
          notes: string | null
          patient_id: string | null
          resolved_at: string | null
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          appointment_id?: string | null
          case_id: string
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          id?: string
          insurer: string
          invoice_number?: string | null
          notes?: string | null
          patient_id?: string | null
          resolved_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          appointment_id?: string | null
          case_id?: string
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          id?: string
          insurer?: string
          invoice_number?: string | null
          notes?: string | null
          patient_id?: string | null
          resolved_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reimbursements_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursements_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "patient_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursements_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
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
            foreignKeyName: "reservation_sessions_office_fk"
            columns: ["doctor_id", "office_id"]
            isOneToOne: false
            referencedRelation: "doctor_offices"
            referencedColumns: ["doctor_id", "id"]
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
      staff_alert_recipients: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string
          receives: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone: string
          receives?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string
          receives?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_alert_settings: {
        Row: {
          created_at: string
          id: boolean
          max_escalations: number
          sla_high_minutes: number
          sla_normal_minutes: number
          sla_urgent_minutes: number
          template_language: string
          template_name: string
          updated_at: string
          updated_by: string | null
          whatsapp_enabled: boolean
        }
        Insert: {
          created_at?: string
          id?: boolean
          max_escalations?: number
          sla_high_minutes?: number
          sla_normal_minutes?: number
          sla_urgent_minutes?: number
          template_language?: string
          template_name?: string
          updated_at?: string
          updated_by?: string | null
          whatsapp_enabled?: boolean
        }
        Update: {
          created_at?: string
          id?: boolean
          max_escalations?: number
          sla_high_minutes?: number
          sla_normal_minutes?: number
          sla_urgent_minutes?: number
          template_language?: string
          template_name?: string
          updated_at?: string
          updated_by?: string | null
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      triage_findmed: {
        Row: {
          accion_operativa: string | null
          especialidad: string
          extra: Json | null
          id: number
          imported_at: string
          keywords: string[]
          origen: string | null
          padecimiento: string | null
          pregunta_diferencial: string | null
          primera_parada: string | null
          requiere_alguno: string[]
          requiere_todos: string[]
          semaforo: string | null
          si_esto_aparece_subir_a_urgencias: string | null
          source: string
          validado: boolean
        }
        Insert: {
          accion_operativa?: string | null
          especialidad: string
          extra?: Json | null
          id?: never
          imported_at?: string
          keywords?: string[]
          origen?: string | null
          padecimiento?: string | null
          pregunta_diferencial?: string | null
          primera_parada?: string | null
          requiere_alguno?: string[]
          requiere_todos?: string[]
          semaforo?: string | null
          si_esto_aparece_subir_a_urgencias?: string | null
          source?: string
          validado?: boolean
        }
        Update: {
          accion_operativa?: string | null
          especialidad?: string
          extra?: Json | null
          id?: never
          imported_at?: string
          keywords?: string[]
          origen?: string | null
          padecimiento?: string | null
          pregunta_diferencial?: string | null
          primera_parada?: string | null
          requiere_alguno?: string[]
          requiere_todos?: string[]
          semaforo?: string | null
          si_esto_aparece_subir_a_urgencias?: string | null
          source?: string
          validado?: boolean
        }
        Relationships: []
      }
      triage_specialty_map: {
        Row: {
          especialidad: string
          notes: string | null
          patient_label: string
          search_specialties: string[]
        }
        Insert: {
          especialidad: string
          notes?: string | null
          patient_label: string
          search_specialties?: string[]
        }
        Update: {
          especialidad?: string
          notes?: string | null
          patient_label?: string
          search_specialties?: string[]
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
      whaapy_events: {
        Row: {
          contact_id: string | null
          conversation_id: string | null
          dedupe_key: string
          event_timestamp: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          processing_error: string | null
          received_at: string
          whaapy_message_id: string | null
        }
        Insert: {
          contact_id?: string | null
          conversation_id?: string | null
          dedupe_key: string
          event_timestamp?: string | null
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          whaapy_message_id?: string | null
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string | null
          dedupe_key?: string
          event_timestamp?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          whaapy_message_id?: string | null
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
      claim_case_alerts: {
        Args: { p_lease_seconds: number; p_limit: number }
        Returns: {
          attempts: number
          case_id: string
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          level: number
          locked_until: string | null
          next_attempt_at: string
          notification_id: string | null
          priority: string
          processed_at: string | null
          updated_at: string
          whatsapp_detail: string | null
          whatsapp_status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "case_alerts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_outbox: {
        Args: { p_lease_seconds: number; p_limit: number }
        Returns: {
          aggregate_id: string | null
          attempts: number
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          last_error: string | null
          locked_until: string | null
          next_attempt_at: string
          payload: Json
          processed_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "domain_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_doctor_id_for_user: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_edge_function: { Args: { function_slug: string }; Returns: number }
      is_admin_or_superadmin: { Args: { _user_id: string }; Returns: boolean }
      staff_alerts_have_work: { Args: never; Returns: boolean }
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
        | "documents_received"
        | "case_opened"
        | "case_handoff"
        | "case_overdue"
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
        "documents_received",
        "case_opened",
        "case_handoff",
        "case_overdue",
      ],
      post_consultation_status: ["pending", "read", "report_sent"],
    },
  },
} as const
