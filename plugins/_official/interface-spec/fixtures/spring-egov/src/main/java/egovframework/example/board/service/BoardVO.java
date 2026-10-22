package egovframework.example.board.service;

public class BoardVO extends BoardDefaultVO {

    private static final long serialVersionUID = 1L;

    /** 게시글 아이디 */
    private String nttId;

    /**
     * 게시글 제목
     */
    private String nttSj;

    private String nttCn; // 게시글 내용

    /** 작성자명 (실명) */
    private String ntcrNm;
}
