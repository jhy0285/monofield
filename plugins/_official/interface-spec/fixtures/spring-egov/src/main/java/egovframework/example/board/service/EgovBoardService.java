package egovframework.example.board.service;

import java.util.List;

public interface EgovBoardService {
    List<BoardVO> selectBoardList(BoardDefaultVO searchVO) throws Exception;
    void insertBoard(BoardVO boardVO) throws Exception;
    BoardVO selectBoard(BoardVO boardVO) throws Exception;
}
