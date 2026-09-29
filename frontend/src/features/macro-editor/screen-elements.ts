export interface ScreenElementOption {
  id: string
  label: string
  collection?: boolean
  param?: 'index' | 'name'
}

export const SCREEN_ELEMENTS: Record<string, ScreenElementOption[]> = {
  study_room_list: [
    { id: 'header_title', label: '화면 제목' },
    { id: 'history_button', label: '최근 내역' },
    { id: 'hero_headline', label: '환영 문구' },
    { id: 'hero_description', label: '화면 설명' },
    { id: 'date_chip', label: '날짜 카드', collection: true },
    { id: 'selected_date_chip', label: '선택 날짜 카드' },
    { id: 'selected_date_label', label: '선택 날짜' },
    { id: 'selected_date_dropdown', label: '날짜 드롭다운' },
    { id: 'live_status_indicator', label: '실시간 현황' },
    { id: 'room_card', label: '스터디룸 카드', collection: true },
    { id: 'room_card_by_name', label: '이름으로 스터디룸 카드', collection: true, param: 'name' },
    { id: 'bottom_tab_home', label: 'Home 탭' },
    { id: 'bottom_tab_booking', label: 'Booking 탭' },
    { id: 'bottom_tab_me', label: 'Me 탭' },
  ],
  reservation_home: [
    { id: 'reservation_history', label: '예약 내역' },
    { id: 'quick_date', label: '빠른 날짜', collection: true },
    { id: 'date_picker', label: '날짜 선택' },
    { id: 'nav_notice', label: '공지 탭' },
    { id: 'nav_reservation', label: '예약 탭' },
    { id: 'nav_my', label: '마이 탭' },
  ],
  reservation_detail: [
    { id: 'back', label: '뒤로가기' },
    { id: 'date_picker', label: '날짜 선택' },
    { id: 'time_slot', label: '시간 슬롯', collection: true },
    { id: 'reset_selection', label: '선택 초기화' },
    { id: 'reserve_cta', label: '예약 CTA' },
  ],
  study_room_detail: [
    { id: 'back', label: '뒤로가기' },
    { id: 'room_hero_image', label: '스터디룸 대표 이미지' },
    { id: 'room_name', label: '스터디룸 이름' },
    { id: 'room_feature', label: '방 특징', collection: true },
    { id: 'selected_date_label', label: '선택 날짜' },
    { id: 'live_status_indicator', label: '실시간 상태' },
    { id: 'slot_guidance', label: '시간 슬롯 안내' },
    { id: 'time_slot', label: '시간 슬롯', collection: true },
    { id: 'current_time_marker', label: '현재 시간 표시' },
    { id: 'legend_reserved', label: '예약됨 범례' },
    { id: 'legend_available', label: '빈 시간 범례' },
    { id: 'legend_selected', label: '선택 범례' },
    { id: 'selection_summary', label: '선택 상태' },
    { id: 'reset_selection', label: '선택 초기화' },
    { id: 'usage_rules', label: '이용 규칙' },
    { id: 'reserve_cta', label: '예약 CTA' },
  ],
}

export const SCREEN_OPTIONS = [
  { id: 'reservation_home', label: '스터디룸 예약 메인' },
  { id: 'reservation_detail', label: '스터디룸 예약 상세' },
] as const

export const SEMANTIC_SCREEN_OPTIONS = [
  ...SCREEN_OPTIONS,
  { id: 'study_room_list', label: '스터디룸 목록' },
  { id: 'study_room_detail', label: '스터디룸 상세' },
] as const
