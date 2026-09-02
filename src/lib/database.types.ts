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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_drafts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          input_snapshot: Json | null
          item_id: string | null
          kind: Database["public"]["Enums"]["ai_draft_kind"]
          model: string | null
          output: string
          report_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          input_snapshot?: Json | null
          item_id?: string | null
          kind: Database["public"]["Enums"]["ai_draft_kind"]
          model?: string | null
          output: string
          report_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          input_snapshot?: Json | null
          item_id?: string | null
          kind?: Database["public"]["Enums"]["ai_draft_kind"]
          model?: string | null
          output?: string
          report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_drafts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_link_unresolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_published_no_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_slot_passed_unpublished"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_ready_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_waiting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          actor_id: string
          created_at: string
          gate: Database["public"]["Enums"]["approval_gate"]
          id: number
          item_id: string
          note: string | null
          result: Database["public"]["Enums"]["approval_result"]
        }
        Insert: {
          actor_id: string
          created_at?: string
          gate: Database["public"]["Enums"]["approval_gate"]
          id?: number
          item_id: string
          note?: string | null
          result: Database["public"]["Enums"]["approval_result"]
        }
        Update: {
          actor_id?: string
          created_at?: string
          gate?: Database["public"]["Enums"]["approval_gate"]
          id?: number
          item_id?: string
          note?: string | null
          result?: Database["public"]["Enums"]["approval_result"]
        }
        Relationships: [
          {
            foreignKeyName: "approvals_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_link_unresolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_published_no_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_slot_passed_unpublished"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_ready_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_waiting"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_types: {
        Row: {
          active: boolean
          id: number
          name: string
        }
        Insert: {
          active?: boolean
          id?: number
          name: string
        }
        Update: {
          active?: boolean
          id?: number
          name?: string
        }
        Relationships: []
      }
      ig_account_daily: {
        Row: {
          date: string
          followers: number | null
          follows: number | null
          media_count: number | null
          reach: number | null
          reach_followers: number | null
          reach_non_followers: number | null
          unfollows: number | null
          views: number | null
        }
        Insert: {
          date: string
          followers?: number | null
          follows?: number | null
          media_count?: number | null
          reach?: number | null
          reach_followers?: number | null
          reach_non_followers?: number | null
          unfollows?: number | null
          views?: number | null
        }
        Update: {
          date?: string
          followers?: number | null
          follows?: number | null
          media_count?: number | null
          reach?: number | null
          reach_followers?: number | null
          reach_non_followers?: number | null
          unfollows?: number | null
          views?: number | null
        }
        Relationships: []
      }
      ig_demographics: {
        Row: {
          dimension: string
          key: string
          snapshot_date: string
          value: number | null
        }
        Insert: {
          dimension: string
          key: string
          snapshot_date: string
          value?: number | null
        }
        Update: {
          dimension?: string
          key?: string
          snapshot_date?: string
          value?: number | null
        }
        Relationships: []
      }
      ig_link_candidates: {
        Row: {
          created_at: string
          day_gap: number | null
          decided_at: string | null
          decided_by: string | null
          id: number
          item_id: string
          margin: number | null
          media_id: string
          similarity: number | null
          state: Database["public"]["Enums"]["link_state"]
        }
        Insert: {
          created_at?: string
          day_gap?: number | null
          decided_at?: string | null
          decided_by?: string | null
          id?: number
          item_id: string
          margin?: number | null
          media_id: string
          similarity?: number | null
          state?: Database["public"]["Enums"]["link_state"]
        }
        Update: {
          created_at?: string
          day_gap?: number | null
          decided_at?: string | null
          decided_by?: string | null
          id?: number
          item_id?: string
          margin?: number | null
          media_id?: string
          similarity?: number | null
          state?: Database["public"]["Enums"]["link_state"]
        }
        Relationships: [
          {
            foreignKeyName: "ig_link_candidates_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_link_unresolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_published_no_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_slot_passed_unpublished"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_ready_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_waiting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_link_candidates_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "ig_link_candidates_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_orphan_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "ig_link_candidates_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["media_id"]
          },
        ]
      }
      ig_post_daily: {
        Row: {
          age_days: number | null
          avg_watch_ms: number | null
          comments: number | null
          follows: number | null
          interactions: number | null
          likes: number | null
          media_id: string
          profile_visits: number | null
          reach: number | null
          saved: number | null
          shares: number | null
          snapshot_date: string
          views: number | null
        }
        Insert: {
          age_days?: number | null
          avg_watch_ms?: number | null
          comments?: number | null
          follows?: number | null
          interactions?: number | null
          likes?: number | null
          media_id: string
          profile_visits?: number | null
          reach?: number | null
          saved?: number | null
          shares?: number | null
          snapshot_date: string
          views?: number | null
        }
        Update: {
          age_days?: number | null
          avg_watch_ms?: number | null
          comments?: number | null
          follows?: number | null
          interactions?: number | null
          likes?: number | null
          media_id?: string
          profile_visits?: number | null
          reach?: number | null
          saved?: number | null
          shares?: number | null
          snapshot_date?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ig_post_daily_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "ig_post_daily_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_orphan_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "ig_post_daily_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["media_id"]
          },
        ]
      }
      ig_posts: {
        Row: {
          caption: string | null
          media_id: string
          media_type: string | null
          permalink: string
          product_type: string | null
          published_at: string
          shortcode: string | null
          synced_at: string
        }
        Insert: {
          caption?: string | null
          media_id: string
          media_type?: string | null
          permalink: string
          product_type?: string | null
          published_at: string
          shortcode?: string | null
          synced_at?: string
        }
        Update: {
          caption?: string | null
          media_id?: string
          media_type?: string | null
          permalink?: string
          product_type?: string | null
          published_at?: string
          shortcode?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      item_participants: {
        Row: {
          added_at: string
          added_by: string | null
          item_id: string
          part: Database["public"]["Enums"]["participant_part"]
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          item_id: string
          part: Database["public"]["Enums"]["participant_part"]
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          item_id?: string
          part?: Database["public"]["Enums"]["participant_part"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_link_unresolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_published_no_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_slot_passed_unpublished"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_ready_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_waiting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      item_partners: {
        Row: {
          added_at: string
          added_by: string | null
          item_id: string
          partner_id: number
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          item_id: string
          partner_id: number
        }
        Update: {
          added_at?: string
          added_by?: string | null
          item_id?: string
          partner_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_partners_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_link_unresolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_published_no_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_slot_passed_unpublished"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_ready_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_waiting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_partners_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "v_partner_month"
            referencedColumns: ["partner_id"]
          },
          {
            foreignKeyName: "item_partners_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "v_partner_track"
            referencedColumns: ["partner_id"]
          },
        ]
      }
      items: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          idea_type_id: number | null
          ig_media_id: string | null
          ig_permalink: string | null
          ig_shortcode: string | null
          is_archived: boolean
          legacy_row: number | null
          legacy_tab: string | null
          notes: string | null
          priority: number | null
          production_file_url: string | null
          writer_delivery_url: string | null
          published_at: string | null
          ref: string
          slot_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          track_id: number | null
          updated_at: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idea_type_id?: number | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          ig_shortcode?: string | null
          is_archived?: boolean
          legacy_row?: number | null
          legacy_tab?: string | null
          notes?: string | null
          priority?: number | null
          production_file_url?: string | null
          published_at?: string | null
          ref?: string
          slot_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          track_id?: number | null
          updated_at?: string
          writer_delivery_url?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idea_type_id?: number | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          ig_shortcode?: string | null
          is_archived?: boolean
          legacy_row?: number | null
          legacy_tab?: string | null
          notes?: string | null
          priority?: number | null
          production_file_url?: string | null
          published_at?: string | null
          ref?: string
          slot_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          track_id?: number | null
          updated_at?: string
          writer_delivery_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_idea_type_id_fkey"
            columns: ["idea_type_id"]
            isOneToOne: false
            referencedRelation: "idea_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_ig_media_id_fkey"
            columns: ["ig_media_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "items_ig_media_id_fkey"
            columns: ["ig_media_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_orphan_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "items_ig_media_id_fkey"
            columns: ["ig_media_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "items_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "publishing_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "v_ready_queue"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "items_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "v_slot_board"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "items_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          active: boolean
          aliases: string[]
          created_at: string
          created_by: string | null
          id: number
          name: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          created_at?: string
          created_by?: string | null
          id?: number
          name: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          created_at?: string
          created_by?: string | null
          id?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "partners_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          must_change_password: boolean
          phone: string | null
          roles: Database["public"]["Enums"]["role_name"][]
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          must_change_password?: boolean
          phone?: string | null
          roles?: Database["public"]["Enums"]["role_name"][]
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          must_change_password?: boolean
          phone?: string | null
          roles?: Database["public"]["Enums"]["role_name"][]
        }
        Relationships: []
      }
      publishing_slots: {
        Row: {
          created_at: string
          id: string
          note: string | null
          slot_at: string
          state: Database["public"]["Enums"]["slot_state"]
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          slot_at: string
          state?: Database["public"]["Enums"]["slot_state"]
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          slot_at?: string
          state?: Database["public"]["Enums"]["slot_state"]
        }
        Relationships: []
      }
      reports: {
        Row: {
          author_id: string | null
          body_md: string | null
          context_note: string | null
          created_at: string
          id: string
          month: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body_md?: string | null
          context_note?: string | null
          created_at?: string
          id?: string
          month: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body_md?: string | null
          context_note?: string | null
          created_at?: string
          id?: string
          month?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          color_hex: string
          id: number
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          color_hex: string
          id: number
          name: string
          slug: string
          sort_order: number
        }
        Update: {
          color_hex?: string
          id?: number
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      transitions: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["item_status"] | null
          id: number
          is_override: boolean
          item_id: string
          note: string | null
          override_reason: string | null
          to_status: Database["public"]["Enums"]["item_status"]
          violations: string[] | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["item_status"] | null
          id?: number
          is_override?: boolean
          item_id: string
          note?: string | null
          override_reason?: string | null
          to_status: Database["public"]["Enums"]["item_status"]
          violations?: string[] | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["item_status"] | null
          id?: number
          is_override?: boolean
          item_id?: string
          note?: string | null
          override_reason?: string | null
          to_status?: Database["public"]["Enums"]["item_status"]
          violations?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "transitions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transitions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transitions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_link_unresolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transitions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_published_no_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transitions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_slot_passed_unpublished"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transitions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transitions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_ready_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transitions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_waiting"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_conflict_link_unresolved: {
        Row: {
          id: string | null
          ig_permalink: string | null
          published_at: string | null
          ref: string | null
          title: string | null
        }
        Insert: {
          id?: string | null
          ig_permalink?: string | null
          published_at?: string | null
          ref?: string | null
          title?: string | null
        }
        Update: {
          id?: string | null
          ig_permalink?: string | null
          published_at?: string | null
          ref?: string | null
          title?: string | null
        }
        Relationships: []
      }
      v_conflict_orphan_posts: {
        Row: {
          caption: string | null
          media_id: string | null
          permalink: string | null
          published_at: string | null
          reach: number | null
        }
        Relationships: []
      }
      v_conflict_published_no_link: {
        Row: {
          id: string | null
          published_at: string | null
          ref: string | null
          title: string | null
        }
        Insert: {
          id?: string | null
          published_at?: string | null
          ref?: string | null
          title?: string | null
        }
        Update: {
          id?: string | null
          published_at?: string | null
          ref?: string | null
          title?: string | null
        }
        Relationships: []
      }
      v_conflict_slot_passed_unpublished: {
        Row: {
          id: string | null
          ref: string | null
          slot_at: string | null
          status: Database["public"]["Enums"]["item_status"] | null
          title: string | null
        }
        Relationships: []
      }
      v_item_performance: {
        Row: {
          color_hex: string | null
          comments: number | null
          follow_rate: number | null
          follows: number | null
          id: string | null
          idea_type: string | null
          idea_type_id: number | null
          likes: number | null
          media_id: string | null
          permalink: string | null
          product_type: string | null
          profile_visits: number | null
          published_at: string | null
          reach: number | null
          ref: string | null
          save_rate: number | null
          saved: number | null
          share_rate: number | null
          shares: number | null
          signal: number | null
          signal_partial: boolean | null
          status: Database["public"]["Enums"]["item_status"] | null
          title: string | null
          track_id: number | null
          track_name: string | null
          views: number | null
          visit_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_idea_type_id_fkey"
            columns: ["idea_type_id"]
            isOneToOne: false
            referencedRelation: "idea_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      v_partner_month: {
        Row: {
          is_thin: boolean | null
          median_reach: number | null
          median_save_rate: number | null
          median_share_rate: number | null
          median_signal: number | null
          month: string | null
          n: number | null
          partner_id: number | null
          partner_name: string | null
        }
        Relationships: []
      }
      v_partner_track: {
        Row: {
          last_collab_at: string | null
          median_reach: number | null
          median_signal: number | null
          n: number | null
          partner_id: number | null
          partner_name: string | null
          sample_sufficient: boolean | null
          track_id: number | null
          track_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      v_post_latest: {
        Row: {
          age_days: number | null
          avg_watch_ms: number | null
          comments: number | null
          follows: number | null
          interactions: number | null
          likes: number | null
          media_id: string | null
          profile_visits: number | null
          reach: number | null
          saved: number | null
          shares: number | null
          snapshot_date: string | null
          views: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ig_post_daily_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "ig_post_daily_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "v_conflict_orphan_posts"
            referencedColumns: ["media_id"]
          },
          {
            foreignKeyName: "ig_post_daily_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "v_item_performance"
            referencedColumns: ["media_id"]
          },
        ]
      }
      v_ready_queue: {
        Row: {
          caption: string | null
          color_hex: string | null
          id: string | null
          idea_type: string | null
          partners: string | null
          production_file_url: string | null
          ref: string | null
          slot_at: string | null
          slot_id: string | null
          title: string | null
          track_id: number | null
          track_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      v_slot_board: {
        Row: {
          n_items: number | null
          n_ready: number | null
          slot_at: string | null
          slot_id: string | null
          state: Database["public"]["Enums"]["slot_state"] | null
        }
        Relationships: []
      }
      v_track_month: {
        Row: {
          color_hex: string | null
          is_thin: boolean | null
          median_reach: number | null
          median_save_rate: number | null
          median_share_rate: number | null
          median_signal: number | null
          month: string | null
          n: number | null
          track_id: number | null
          track_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      v_waiting: {
        Row: {
          id: string | null
          people: string | null
          ref: string | null
          slot_at: string | null
          status: Database["public"]["Enums"]["item_status"] | null
          title: string | null
          track_id: number | null
          track_name: string | null
          waiting_on: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      advance_item: {
        Args: {
          p_item: string
          p_note?: string
          p_override_reason?: string
          p_to: Database["public"]["Enums"]["item_status"]
        }
        Returns: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          idea_type_id: number | null
          ig_media_id: string | null
          ig_permalink: string | null
          ig_shortcode: string | null
          is_archived: boolean
          legacy_row: number | null
          legacy_tab: string | null
          notes: string | null
          priority: number | null
          production_file_url: string | null
          writer_delivery_url: string | null
          published_at: string | null
          ref: string
          slot_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          track_id: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      allowed_edge: {
        Args: {
          p_from: Database["public"]["Enums"]["item_status"]
          p_to: Database["public"]["Enums"]["item_status"]
        }
        Returns: boolean
      }
      app_tz: { Args: never; Returns: string }
      assign_slot: {
        Args: { p_item: string; p_slot: string }
        Returns: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          idea_type_id: number | null
          ig_media_id: string | null
          ig_permalink: string | null
          ig_shortcode: string | null
          is_archived: boolean
          legacy_row: number | null
          legacy_tab: string | null
          notes: string | null
          priority: number | null
          production_file_url: string | null
          writer_delivery_url: string | null
          published_at: string | null
          ref: string
          slot_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          track_id: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      content_gate_signatures: { Args: never; Returns: number }
      ensure_slots: { Args: { p_weeks?: number }; Returns: number }
      has_role: {
        Args: { p_role: Database["public"]["Enums"]["role_name"] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_participant: { Args: { p_item: string }; Returns: boolean }
      item_violations: {
        Args: {
          p_item: string
          p_to: Database["public"]["Enums"]["item_status"]
        }
        Returns: string[]
      }
      mark_published: {
        Args: {
          p_at?: string
          p_item: string
          p_override_reason?: string
          p_permalink: string
        }
        Returns: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          idea_type_id: number | null
          ig_media_id: string | null
          ig_permalink: string | null
          ig_shortcode: string | null
          is_archived: boolean
          legacy_row: number | null
          legacy_tab: string | null
          notes: string | null
          priority: number | null
          production_file_url: string | null
          writer_delivery_url: string | null
          published_at: string | null
          ref: string
          slot_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          track_id: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_reassign_tasks: {
        Args: {
          p_dry_run?: boolean
          p_parts: Database["public"]["Enums"]["participant_part"][]
          p_reason?: string | null
          p_source: string
          p_target: string
        }
        Returns: Json
      }
      save_item_fields: {
        Args: { p_fields: Json; p_item: string }
        Returns: Database["public"]["Tables"]["items"]["Row"]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_item_partners: {
        Args: {
          p_item: string
          p_new_partner_name?: string
          p_partner_ids?: number[]
        }
        Returns: Json
      }
      me: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          must_change_password: boolean
          phone: string | null
          roles: Database["public"]["Enums"]["role_name"][]
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_item: {
        Args: {
          p_gate: Database["public"]["Enums"]["approval_gate"]
          p_item: string
          p_note: string
        }
        Returns: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          idea_type_id: number | null
          ig_media_id: string | null
          ig_permalink: string | null
          ig_shortcode: string | null
          is_archived: boolean
          legacy_row: number | null
          legacy_tab: string | null
          notes: string | null
          priority: number | null
          production_file_url: string | null
          writer_delivery_url: string | null
          published_at: string | null
          ref: string
          slot_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          track_id: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      ai_draft_kind: "monthly_report" | "caption_review" | "collab_suggestion"
      approval_gate: "content" | "design"
      approval_result: "approve" | "reject"
      item_status:
        | "idea"
        | "writing"
        | "content_approved"
        | "in_production"
        | "design_approved"
        | "ready"
        | "published"
        | "cancelled"
      link_state: "pending" | "confirmed" | "rejected"
      participant_part: "writer" | "producer" | "reviewer"
      role_name: "writer" | "reviewer" | "producer" | "publisher" | "admin"
      slot_state: "open" | "assigned" | "published" | "skipped"
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
      ai_draft_kind: ["monthly_report", "caption_review", "collab_suggestion"],
      approval_gate: ["content", "design"],
      approval_result: ["approve", "reject"],
      item_status: [
        "idea",
        "writing",
        "content_approved",
        "in_production",
        "design_approved",
        "ready",
        "published",
        "cancelled",
      ],
      link_state: ["pending", "confirmed", "rejected"],
      participant_part: ["writer", "producer", "reviewer"],
      role_name: ["writer", "reviewer", "producer", "publisher", "admin"],
      slot_state: ["open", "assigned", "published", "skipped"],
    },
  },
} as const

