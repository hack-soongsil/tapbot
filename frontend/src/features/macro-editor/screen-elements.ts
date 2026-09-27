export interface ScreenElementOption {
  id: string
  label: string
  collection?: boolean
}

export const SCREEN_ELEMENTS: Record<string, ScreenElementOption[]> = {
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
    { id: 'time_slot', label: '30분 시간 슬롯', collection: true },
    { id: 'reset_selection', label: '선택 초기화' },
    { id: 'reserve_cta', label: '예약 CTA' },
  ],
}

export const SCREEN_OPTIONS = [
  { id: 'reservation_home', label: '스터디룸 예약 메인' },
  { id: 'reservation_detail', label: '스터디룸 예약 상세' },
] as const
